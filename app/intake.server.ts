/**
 * An import that is not finished yet (D40): its pages, their corners and sizes,
 * the fields as read and corrected, and the one act that turns all of it into
 * a document.
 *
 * Who reaches an intake is the database's call (`0017_intakes.sql`): its
 * uploader and the admins. Nothing here checks it; a draft somebody else may
 * not see produces no row, and a change to one is refused.
 *
 * Blobs are deleted only after the transaction that stopped pointing at them
 * has committed. Functions that release blobs return their storage keys for
 * the caller to delete afterwards: deleting inside the transaction would lose
 * the bytes of a draft whose rows a later failure then rolled back.
 *
 * Nothing in this module logs. Page sizes, corners and field values describe
 * the paper.
 */

import { randomUUID } from "node:crypto";

import { PDFDocument } from "@cantoo/pdf-lib";
import { sql } from "drizzle-orm";
import sharp from "sharp";

import { ACCEPTED_TYPES, CATEGORIES, MAX_UPLOAD_BYTES, type Category } from "./documents";
import { openFile, sealFile } from "./crypto.server";
import type { VaultTransaction } from "./db.server";
import { openIdentifier, sealIdentifier } from "./field-crypto.server";
import type { ReadResult } from "./ocr.server";
import { PAPER_SIZES, sizesShaped, type PaperSize } from "./paper";
import {
  buildPdf,
  checkPdf,
  type BuiltPage,
  type Corners,
  findCorners,
  flatten,
  scannedSize,
  sizeFor,
} from "./paper.server";
import { EDITABLE_FIELDS, saveExtraction, saveFields, type EditableField } from "./record.server";
import { getBlob, putBlob, storageKeyFor } from "./storage.server";
import { fileDocument, UploadRefused } from "./upload.server";

export { UploadRefused };

/** A photo's outline, in its upright pixels, and whether it was found or is the photo's edges. */
export type Outline = { points: Corners; found: boolean; width: number; height: number };

export type IntakePage = {
  id: string;
  position: number;
  sourceId: string;
  sourcePage: number;
  mime: string;
  kind: "photo" | "pdf-page";
  corners: Outline | null;
  size: PaperSize | null;
  rotation: number;
};

/** One field as it stands: what the reader proposed or a person typed, and which. */
export type FieldState = { value?: string; source: "person" | "pdf-text" | "mrz" | "page-text"; masked?: boolean; verified?: boolean };

export type IntakeView = {
  id: string;
  createdBy: string;
  ownerId: string | null;
  category: Category | null;
  title: string | null;
  recordId: string | null;
  values: Partial<Record<EditableField, FieldState>>;
  /** The reader's own sentence about how it read. Null before it has. */
  how: string | null;
  hasIdentifier: boolean;
  pages: IntakePage[];
};

type Stored = { fields: { values?: IntakeView["values"]; how?: string; terms?: unknown } };

/* ------------------------------------------------------------------ */
/* Arriving                                                            */
/* ------------------------------------------------------------------ */

export function checkUpload(upload: { mime: string; size: number }): void {
  if (upload.size === 0) throw new UploadRefused("That file is empty.");
  if (upload.size > MAX_UPLOAD_BYTES) {
    throw new UploadRefused(`Files are limited to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  if (!ACCEPTED_TYPES.includes(upload.mime as (typeof ACCEPTED_TYPES)[number])) {
    throw new UploadRefused("That file type cannot be stored here. PDF or a photo (JPEG, PNG, WebP, TIFF).");
  }
}

export type Examined = { pages: { sourcePage: number; corners: Outline | null; size: PaperSize | null }[] };

/**
 * What an upload holds, worked out before any transaction opens: a PDF's page
 * count, or a photo's outline and a guess at its size. A guess is made only
 * when exactly one size fits the outline's shape; a scan that recorded its
 * resolution and shows no outline is taken as scanned.
 */
export async function examine(bytes: Buffer, mime: string): Promise<Examined> {
  checkUpload({ mime, size: bytes.length });

  if (mime === "application/pdf") {
    let count: number;
    try {
      count = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
    } catch {
      throw new UploadRefused("That PDF cannot be opened here. If it has a password, remove it first.");
    }
    if (count === 0) throw new UploadRefused("That PDF has no pages.");
    return { pages: Array.from({ length: count }, (_, i) => ({ sourcePage: i, corners: null, size: null })) };
  }

  let outline;
  try {
    outline = await findCorners(bytes);
  } catch {
    throw new UploadRefused("That photo cannot be opened. Try saving it as a JPEG.");
  }
  const corners: Outline = { points: outline.corners, found: outline.found, width: outline.width, height: outline.height };
  let size: PaperSize | null = null;
  if (outline.found) {
    const [tl, tr, br, bl] = outline.corners;
    const across = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1]);
    const down = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) + Math.hypot(br[0] - tr[0], br[1] - tr[1]);
    const shapes = sizesShaped(across, down);
    size = shapes.length === 1 ? shapes[0] : null;
  } else if (await scannedSize(bytes)) {
    size = "scanned";
  }
  return { pages: [{ sourcePage: 0, corners, size }] };
}

/** A new draft in the caller's own name. The policy refuses any other. */
export async function startIntake(
  db: VaultTransaction,
  createdBy: string,
  init: { ownerId?: string | null; category?: string | null; title?: string | null; recordId?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  const category = init.category && CATEGORIES.includes(init.category as Category) ? init.category : null;
  await db.execute(sql`
    insert into intakes (id, created_by, owner_id, category, title, record_id)
    values (${id}, ${createdBy}, ${init.ownerId || null}, ${category}, ${init.title?.trim() || null}, ${init.recordId || null})
  `);
  return id;
}

/**
 * Seal one upload into an intake and add its pages after the ones already
 * there. Rows first, so a draft the caller may not touch is refused before a
 * byte is written; the blob last, so a full disk takes the rows back with it.
 */
export async function addSource(
  db: VaultTransaction,
  intakeId: string,
  upload: { mime: string; bytes: Buffer },
  examined: Examined,
): Promise<void> {
  const sourceId = randomUUID();
  const storageKey = storageKeyFor(sourceId);
  const sealed = sealFile(upload.bytes, sourceId);

  await db.execute(sql`
    insert into intake_sources (id, intake_id, storage_key, sha256, byte_size, mime, wrapped_dek, nonce)
    values (${sourceId}, ${intakeId}, ${storageKey}, ${sealed.sha256}, ${sealed.byteSize}, ${upload.mime},
            ${sealed.wrappedDek}, ${sealed.nonce})
  `);

  const [{ next }] = [
    ...(await db.execute<{ next: number }>(
      sql`select coalesce(max(position), 0) + 1 as next from intake_pages where intake_id = ${intakeId}`,
    )),
  ];
  for (const [i, page] of examined.pages.entries()) {
    await db.execute(sql`
      insert into intake_pages (intake_id, source_id, source_page, position, corners, size)
      values (${intakeId}, ${sourceId}, ${page.sourcePage}, ${next + i},
              ${page.corners ? JSON.stringify(page.corners) : null}::jsonb,
              ${page.size === null ? null : JSON.stringify(page.size)}::jsonb)
    `);
  }
  await db.execute(sql`update intakes set updated_at = now() where id = ${intakeId}`);
  await putBlob(storageKey, sealed.stored);
}

/* ------------------------------------------------------------------ */
/* Reading back                                                        */
/* ------------------------------------------------------------------ */

export async function loadIntake(db: VaultTransaction, intakeId: string): Promise<IntakeView | null> {
  const rows = await db.execute<{
    id: string; createdBy: string; ownerId: string | null; category: Category | null; title: string | null;
    recordId: string | null; fields: Stored["fields"]; hasIdentifier: boolean;
  }>(sql`
    select id, created_by as "createdBy", owner_id as "ownerId", category, title, record_id as "recordId",
           fields, (identifier_sealed is not null) as "hasIdentifier"
    from intakes where id = ${intakeId}
  `);
  const row = [...rows][0];
  if (!row) return null;

  const pages = await db.execute<Omit<IntakePage, "kind">>(sql`
    select p.id, p.position, p.source_id as "sourceId", p.source_page as "sourcePage", s.mime,
           p.corners, p.size, p.rotation
    from intake_pages p join intake_sources s on s.id = p.source_id
    where p.intake_id = ${intakeId}
    order by p.position
  `);

  return {
    id: row.id,
    createdBy: row.createdBy,
    ownerId: row.ownerId,
    category: row.category,
    title: row.title,
    recordId: row.recordId,
    values: row.fields.values ?? {},
    how: row.fields.how ?? null,
    hasIdentifier: row.hasIdentifier,
    pages: [...pages].map((p) => ({ ...p, kind: p.mime === "application/pdf" ? "pdf-page" : "photo" })),
  };
}

/** Every draft the caller reaches, newest first: their own, or every one for an admin. */
export async function listIntakes(db: VaultTransaction) {
  const rows = await db.execute<{ id: string; title: string | null; ownerName: string | null; pages: number; updatedAt: Date; createdBy: string }>(sql`
    select i.id, i.title, o.display_name as "ownerName", i.created_by as "createdBy", i.updated_at as "updatedAt",
           (select count(*)::int from intake_pages p where p.intake_id = i.id) as pages
    from intakes i left join owners o on o.id = i.owner_id
    order by i.updated_at desc
  `);
  return [...rows];
}

/** One source's plaintext, opened and checked the way a document file is. */
async function sourceBytes(db: VaultTransaction, sourceId: string): Promise<Buffer> {
  const rows = await db.execute<{ storageKey: string; wrappedDek: Buffer; nonce: Buffer; sha256: string }>(sql`
    select storage_key as "storageKey", wrapped_dek as "wrappedDek", nonce, sha256
    from intake_sources where id = ${sourceId}
  `);
  const row = [...rows][0];
  if (!row) throw new Response("No such page.", { status: 404 });
  const plain = openFile({ stored: await getBlob(row.storageKey), nonce: Buffer.from(row.nonce), wrappedDek: Buffer.from(row.wrappedDek) }, sourceId);
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(plain).digest("hex") !== row.sha256) {
    throw new Error("An intake source does not match the digest recorded for it.");
  }
  return plain;
}

/**
 * A page for the review screen. A photo comes back as a JPEG no larger than
 * `max` on its long side: flattened, or as photographed (for the corner
 * editor, whose handles are in the photo's own pixels). A page of an uploaded
 * PDF comes back as a one-page PDF, for the browser's own viewer.
 */
export async function pagePreview(
  db: VaultTransaction,
  intakeId: string,
  pageId: string,
  view: "flat" | "photo",
  max = 1200,
): Promise<{ bytes: Buffer; type: string } | null> {
  const intake = await loadIntake(db, intakeId);
  const page = intake?.pages.find((p) => p.id === pageId);
  if (!page) return null;
  const bytes = await sourceBytes(db, page.sourceId);

  if (page.kind === "pdf-page") {
    const one = await PDFDocument.create();
    const [copied] = await one.copyPages(await PDFDocument.load(bytes, { updateMetadata: false }), [page.sourcePage]);
    one.addPage(copied);
    return { bytes: Buffer.from(await one.save()), type: "application/pdf" };
  }

  const image = view === "flat" ? (await renderImagePage(bytes, page)).bytes : bytes;
  const out = await sharp(image, { limitInputPixels: 40_000_000 })
    .autoOrient()
    .resize(max, max, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { bytes: out, type: "image/jpeg" };
}

/**
 * A photo page as it will be filed: warped onto its corners at its size, or a
 * scan at its own resolution. A scan that is already an upright JPEG or PNG
 * goes in byte for byte and needs no attachment, being its own original.
 */
async function renderImagePage(
  bytes: Buffer,
  page: IntakePage,
): Promise<{ bytes: Buffer; format: "jpg" | "png"; mm: { w: number; h: number }; isOriginal: boolean }> {
  if (!page.size) throw new UploadRefused(`Choose a size for page ${page.position}.`);

  if (page.size === "scanned") {
    const mm = await scannedSize(bytes);
    if (!mm) throw new UploadRefused(`Page ${page.position} did not record its resolution. Choose a size for it.`);
    const meta = await sharp(bytes).metadata();
    const upright = (meta.orientation ?? 1) === 1 && page.rotation === 0;
    if (upright && (meta.format === "jpeg" || meta.format === "png")) {
      return { bytes, format: meta.format === "jpeg" ? "jpg" : "png", mm, isOriginal: true };
    }
    const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 }).autoOrient().rotate(page.rotation).jpeg({ quality: 92 }).toBuffer();
    const turned = page.rotation === 90 || page.rotation === 270;
    return { bytes: jpeg, format: "jpg", mm: turned ? { w: mm.h, h: mm.w } : mm, isOriginal: false };
  }

  const corners = page.corners!.points;
  const flat = await flatten(bytes, corners, sizeFor(page.size, corners), page.rotation);
  return { bytes: flat.jpeg, format: "jpg", mm: flat.mm, isOriginal: false };
}

/* ------------------------------------------------------------------ */
/* Changing                                                            */
/* ------------------------------------------------------------------ */

const PRESETS = Object.keys(PAPER_SIZES);

/** A size from the form: a preset key, "scanned", or millimetres typed in. */
export function parseSize(choice: string, w?: string, h?: string): PaperSize | null {
  if (PRESETS.includes(choice)) return choice as PaperSize;
  if (choice === "scanned") return "scanned";
  if (choice === "custom") {
    const width = Number(w);
    const height = Number(h);
    const sane = (mm: number) => Number.isFinite(mm) && mm >= 20 && mm <= 1000;
    if (!sane(width) || !sane(height)) throw new UploadRefused("A size is between 20 and 1000 mm each way.");
    return { w: width, h: height };
  }
  return null;
}

export async function setPage(
  db: VaultTransaction,
  pageId: string,
  change: { size?: PaperSize | null; rotation?: number; corners?: Outline },
): Promise<void> {
  if (change.rotation !== undefined && ![0, 90, 180, 270].includes(change.rotation)) {
    throw new UploadRefused("A page turns a quarter at a time.");
  }
  const sets = [];
  if ("size" in change) sets.push(sql`size = ${change.size === null ? null : JSON.stringify(change.size)}::jsonb`);
  if (change.rotation !== undefined) sets.push(sql`rotation = ${change.rotation}`);
  if (change.corners) sets.push(sql`corners = ${JSON.stringify(change.corners)}::jsonb`);
  if (sets.length === 0) return;
  await db.execute(sql`update intake_pages set ${sql.join(sets, sql`, `)} where id = ${pageId}`);
}

/** Swap a page with its neighbour above or below. */
export async function movePage(db: VaultTransaction, intakeId: string, pageId: string, by: -1 | 1): Promise<void> {
  const intake = await loadIntake(db, intakeId);
  if (!intake) return;
  const i = intake.pages.findIndex((p) => p.id === pageId);
  const j = i + by;
  if (i < 0 || j < 0 || j >= intake.pages.length) return;
  const [a, b] = [intake.pages[i], intake.pages[j]];
  await db.execute(sql`update intake_pages set position = ${b.position} where id = ${a.id}`);
  await db.execute(sql`update intake_pages set position = ${a.position} where id = ${b.id}`);
}

/** Take a page out. Returns the storage key of a source no page uses any more, to delete after commit. */
export async function removePage(db: VaultTransaction, intakeId: string, pageId: string): Promise<string[]> {
  const gone = await db.execute<{ sourceId: string }>(sql`
    delete from intake_pages where id = ${pageId} and intake_id = ${intakeId} returning source_id as "sourceId"
  `);
  const sourceId = [...gone][0]?.sourceId;
  if (!sourceId) return [];
  const orphan = await db.execute<{ storageKey: string }>(sql`
    delete from intake_sources s
    where s.id = ${sourceId} and not exists (select 1 from intake_pages p where p.source_id = s.id)
    returning storage_key as "storageKey"
  `);
  return [...orphan].map((r) => r.storageKey);
}

/** Discard the whole draft. Returns every storage key it held, to delete after commit. */
export async function discardIntake(db: VaultTransaction, intakeId: string): Promise<string[]> {
  const keys = await db.execute<{ storageKey: string }>(
    sql`select storage_key as "storageKey" from intake_sources where intake_id = ${intakeId}`,
  );
  const gone = await db.execute(sql`delete from intakes where id = ${intakeId} returning 1`);
  return gone.length > 0 ? [...keys].map((r) => r.storageKey) : [];
}

/**
 * Save the details form. Every field given a value was typed or accepted by a
 * person and is marked so; the identifier is sealed under the intake's id and
 * never stored as itself (D35).
 */
export async function saveDetails(
  db: VaultTransaction,
  intakeId: string,
  details: { ownerId: string; category: string; title: string; values: Partial<Record<EditableField, string>> },
): Promise<void> {
  const intake = await loadIntake(db, intakeId);
  if (!intake) return;
  const values = { ...intake.values };
  let identifier: Buffer | null | undefined;

  for (const field of EDITABLE_FIELDS) {
    if (!(field in details.values)) continue;
    const value = (details.values[field] ?? "").trim();
    if (field === "identifier") {
      // Left blank with one already on file means "keep it": the form never
      // receives the number, so blank cannot mean anything else.
      if (value === "") continue;
      identifier = sealIdentifier(value, intakeId);
      values.identifier = { source: "person", masked: true };
      continue;
    }
    if (value === "") delete values[field];
    else values[field] = { value, source: "person" };
  }

  const category = CATEGORIES.includes(details.category as Category) ? details.category : null;
  await db.execute(sql`
    update intakes set
      owner_id = ${details.ownerId || null},
      category = ${category},
      title = ${details.title.trim().slice(0, 200) || null},
      fields = jsonb_set(fields, '{values}', ${JSON.stringify(values)}::jsonb),
      ${identifier === undefined ? sql`` : sql`identifier_sealed = ${identifier},`}
      updated_at = now()
    where id = ${intakeId}
  `);
}

/** Forget the identifier on file, the one way to clear it. */
export async function clearIdentifier(db: VaultTransaction, intakeId: string): Promise<void> {
  await db.execute(sql`
    update intakes set identifier_sealed = null, fields = fields #- '{values,identifier}', updated_at = now()
    where id = ${intakeId}
  `);
}

/* ------------------------------------------------------------------ */
/* Reading the pages                                                   */
/* ------------------------------------------------------------------ */

/**
 * What the reader should look at: each photo page as it will be filed (a flat
 * page reads far better than the angled photo did), and each uploaded PDF once.
 * Pages without a size yet are read as photographed.
 */
export async function readablePages(db: VaultTransaction, intakeId: string): Promise<{ bytes: Buffer; mime: string }[]> {
  const intake = await loadIntake(db, intakeId);
  if (!intake) return [];
  const out: { bytes: Buffer; mime: string }[] = [];
  const seen = new Set<string>();
  for (const page of intake.pages) {
    if (page.kind === "pdf-page") {
      if (seen.has(page.sourceId)) continue;
      seen.add(page.sourceId);
      out.push({ bytes: await sourceBytes(db, page.sourceId), mime: "application/pdf" });
      continue;
    }
    const bytes = await sourceBytes(db, page.sourceId);
    const flat = page.size ? await renderImagePage(bytes, page).catch(() => null) : null;
    out.push(flat ? { bytes: flat.bytes, mime: flat.format === "png" ? "image/png" : "image/jpeg" } : { bytes, mime: page.mime });
  }
  return out;
}

/**
 * Write what the reader proposed. A field a person typed is never overwritten;
 * an earlier proposal is, so a better read improves a worse one (D26).
 */
export async function saveRead(db: VaultTransaction, intakeId: string, reads: (ReadResult | null)[]): Promise<number> {
  const intake = await loadIntake(db, intakeId);
  if (!intake) return 0;
  const values = { ...intake.values };
  let identifier: Buffer | undefined;
  let proposed = 0;
  const terms = reads.find((r) => r?.terms)?.terms;

  // The first page to propose a field wins within one read; a field a person
  // typed is never touched; anything the reader said before is replaced.
  const fresh = new Map<EditableField, { value: string; source: FieldState["source"]; verified: boolean }>();
  for (const p of reads.flatMap((r) => r?.proposals ?? [])) {
    if ((EDITABLE_FIELDS as readonly string[]).includes(p.field) && !fresh.has(p.field as EditableField)) {
      fresh.set(p.field as EditableField, p);
    }
  }
  for (const [field, p] of fresh) {
    if (values[field]?.source === "person") continue;
    if (field === "identifier") {
      identifier = sealIdentifier(p.value, intakeId);
      values.identifier = { source: p.source, masked: true, verified: p.verified };
    } else {
      values[field] = { value: p.value, source: p.source, verified: p.verified };
    }
    proposed += 1;
  }

  const how = reads.map((r) => r?.how).filter(Boolean).join(" ") || "The reader could not open these pages.";
  const fields = { values, how, ...(terms ? { terms } : {}) };
  await db.execute(sql`
    update intakes set fields = ${JSON.stringify(fields)}::jsonb,
      ${identifier === undefined ? sql`` : sql`identifier_sealed = ${identifier},`}
      updated_at = now()
    where id = ${intakeId}
  `);
  return proposed;
}

/* ------------------------------------------------------------------ */
/* Finishing                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build the PDF, check it, and file it (D39, D40).
 *
 * Refused, with the reason, while anything is missing: whose it is, what it
 * is, where it belongs, a page, a size for every photo. The PDF is read back
 * and checked before a row is written. Then the document is filed through the
 * same path as ever, so `records_write` decides whose drawer it may go in; the
 * fields arrive confirmed, because a person has just reviewed them; and the
 * intake is deleted in the same transaction. Its blobs are returned for the
 * caller to delete once that has committed.
 *
 * ponytail: building happens inside the transaction, a few seconds for a
 * handful of photographed pages. Move it before the transaction if drafts ever
 * get long enough for that to hold locks noticeably.
 */
export async function submitIntake(
  db: VaultTransaction,
  intakeId: string,
): Promise<{ documentId: string; released: string[] }> {
  const intake = await loadIntake(db, intakeId);
  if (!intake) throw new Response("No such draft.", { status: 404 });
  if (!intake.ownerId) throw new UploadRefused("Choose whose it is.");
  if (!intake.title) throw new UploadRefused("Give it a name.");
  if (!intake.category) throw new UploadRefused("Choose where it belongs.");
  if (intake.pages.length === 0) throw new UploadRefused("Add at least one page.");
  if (intake.recordId) throw new UploadRefused("Converting a filed document is not built yet.");

  const sources = new Map<string, Buffer>();
  const bytesOf = async (sourceId: string) => {
    if (!sources.has(sourceId)) sources.set(sourceId, await sourceBytes(db, sourceId));
    return sources.get(sourceId)!;
  };

  const built: BuiltPage[] = [];
  for (const [i, page] of intake.pages.entries()) {
    const bytes = await bytesOf(page.sourceId);
    if (page.kind === "pdf-page") {
      built.push({ kind: "pdf", source: bytes, index: page.sourcePage, rotation: page.rotation });
      continue;
    }
    const image = await renderImagePage(bytes, { ...page, position: i + 1 });
    built.push({
      kind: "image",
      bytes: image.bytes,
      format: image.format,
      mm: image.mm,
      original: image.isOriginal ? undefined : { bytes, mime: page.mime, name: `page-${i + 1}-original.${extensionOf(page.mime)}` },
    });
  }

  const pdf = await buildPdf(intake.title, built);
  await checkPdf(pdf.bytes, pdf.expected);

  const filed = await fileDocument(db, {
    ownerId: intake.ownerId,
    category: intake.category,
    title: intake.title,
    mime: "application/pdf",
    bytes: pdf.bytes,
  });

  const values: Partial<Record<EditableField, string>> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field === "identifier") continue;
    const value = intake.values[field]?.value;
    if (value) values[field] = value;
  }
  if (intake.hasIdentifier) {
    const [{ sealed }] = [
      ...(await db.execute<{ sealed: Buffer }>(sql`select identifier_sealed as sealed from intakes where id = ${intakeId}`)),
    ];
    values.identifier = openIdentifier(Buffer.from(sealed), intakeId);
  }
  await saveFields(db, filed.documentId, values);

  const stored = [...(await db.execute<Stored>(sql`select fields from intakes where id = ${intakeId}`))][0];
  if (stored?.fields.terms) {
    await saveExtraction(db, filed.documentId, stored.fields.terms as Parameters<typeof saveExtraction>[2]);
  }

  return { documentId: filed.documentId, released: await discardIntake(db, intakeId) };
}

function extensionOf(mime: string): string {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/tiff": "tiff" }[mime] ?? "bin";
}
