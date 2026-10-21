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
import { readPdf, textLayer, type ReadResult } from "./ocr.server";
import { pagesAsImages } from "./pdf-pages.server";
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
import { EDITABLE_FIELDS, findRecordView, saveExtraction, saveFields, sealedProposal, type EditableField } from "./record.server";
import { findFile, readFileContents } from "./download.server";
import { getBlob, putBlob, storageKeyFor } from "./storage.server";
import { fileDocument, fileVersion, UploadRefused } from "./upload.server";
import { isUuid } from "./ids";

export { UploadRefused };

/**
 * Filing would supersede a version filed after this draft was opened (D42).
 * Not a refusal of the person: the route shows both and asks.
 */
export class NewerVersion extends Error {
  constructor(readonly newerDocumentId: string) {
    super("A newer version was filed while this draft was open.");
  }
}

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
  /** The version current when a conversion was opened (D42). */
  baseDocumentId: string | null;
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

/** More pages than this in one TIFF is a job for a scanner's PDF setting. */
const MAX_TIFF_PAGES = 50;

/**
 * A TIFF can hold several pages, and every step after this one reads only the
 * first. So a TIFF of several pages arrives as several uploads, one PNG a page:
 * lossless, and a format each of those steps reads. Anything else, and a TIFF
 * of one page, comes through as it is.
 */
export async function splitPages(upload: { mime: string; bytes: Buffer }): Promise<{ mime: string; bytes: Buffer }[]> {
  if (upload.mime !== "image/tiff") return [upload];
  checkUpload({ mime: upload.mime, size: upload.bytes.length });
  // Unreadable is not decided here: `examine` refuses it in its own words.
  const count = (await sharp(upload.bytes).metadata().catch(() => null))?.pages ?? 1;
  if (count <= 1) return [upload];
  if (count > MAX_TIFF_PAGES) throw new UploadRefused(`That TIFF has more than ${MAX_TIFF_PAGES} pages. Save it as a PDF instead.`);
  const pages = [];
  for (let page = 0; page < count; page++) {
    pages.push({ mime: "image/png", bytes: await sharp(upload.bytes, { page, limitInputPixels: 40_000_000 }).png().toBuffer() });
  }
  return pages;
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
    // Reading the header alone is not held to the ceiling, so it says which.
    const meta = await sharp(bytes).metadata().catch(() => null);
    if (meta?.width && meta.height && meta.width * meta.height > 40_000_000) {
      throw new UploadRefused("That photo is over 40 megapixels. Save a smaller copy and file that.");
    }
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
  init: {
    ownerId?: string | null;
    category?: string | null;
    title?: string | null;
    recordId?: string | null;
    baseDocumentId?: string | null;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const category = init.category && CATEGORIES.includes(init.category as Category) ? init.category : null;
  await db.execute(sql`
    insert into intakes (id, created_by, owner_id, category, title, record_id, base_document_id)
    values (${id}, ${createdBy}, ${init.ownerId || null}, ${category}, ${init.title?.trim() || null},
            ${init.recordId || null}, ${init.baseDocumentId || null})
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
  if (!isUuid(intakeId)) return null;
  const rows = await db.execute<{
    id: string; createdBy: string; ownerId: string | null; category: Category | null; title: string | null;
    recordId: string | null; baseDocumentId: string | null; fields: Stored["fields"]; hasIdentifier: boolean;
  }>(sql`
    select id, created_by as "createdBy", owner_id as "ownerId", category, title, record_id as "recordId",
           base_document_id as "baseDocumentId", fields, (identifier_sealed is not null) as "hasIdentifier"
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
    baseDocumentId: row.baseDocumentId,
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

  // A conversion files the next version of a record that already has an
  // owner, a name and a kind (D39), and keeps them whatever the form says.
  const kept = intake.recordId ? { ownerId: intake.ownerId ?? "", category: intake.category ?? "", title: intake.title ?? "" } : details;
  const category = CATEGORIES.includes(kept.category as Category) ? kept.category : null;
  await db.execute(sql`
    update intakes set
      owner_id = ${kept.ownerId || null},
      category = ${category},
      title = ${kept.title.trim().slice(0, 200) || null},
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

  // Each upload explains itself; a sentence said twice is said once.
  const sentences = reads.flatMap((r) => r?.how?.split(/(?<=\.)\s+/) ?? []).filter(Boolean);
  const how = [...new Set(sentences)].join(" ") || "The reader could not open these pages.";
  // The number itself went into identifier_sealed above; the copy in what the
  // reader proposed is sealed too, value and note, before it is stored (D35).
  const fields = { values, how, ...(terms ? { terms: { ...terms, proposals: terms.proposals.map(sealedProposal) } } : {}) };
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
  /** The newer version the person has seen and chosen to file over (D42). */
  confirm: { over?: string } = {},
): Promise<{ documentId: string; released: string[] }> {
  // One filing per draft. A second press of File it, or the uploader and the
  // admin at once, waits here for the first to commit, and then finds the
  // draft gone rather than filing it a second time.
  if (!isUuid(intakeId)) throw new Response("No such draft.", { status: 404 });
  const [held] = [...(await db.execute(sql`select 1 from intakes where id = ${intakeId} for update`))];
  if (!held) throw new UploadRefused("This draft has already been filed or thrown away.");
  const intake = await loadIntake(db, intakeId);
  if (!intake) throw new Response("No such draft.", { status: 404 });
  if (!intake.ownerId) throw new UploadRefused("Choose whose it is.");
  if (!intake.title) throw new UploadRefused("Give it a name.");
  if (!intake.category) throw new UploadRefused("Choose where it belongs.");
  if (intake.pages.length === 0) throw new UploadRefused("Add at least one page.");
  if (intake.recordId) await checkStillNewest(db, intake.recordId, intake.baseDocumentId, confirm.over);

  const sources = new Map<string, Buffer>();
  const bytesOf = async (sourceId: string) => {
    if (!sources.has(sourceId)) sources.set(sourceId, await sourceBytes(db, sourceId));
    return sources.get(sourceId)!;
  };

  // Whether each uploaded PDF already carries words. A scan does not, and
  // gets an invisible text layer read from its pages, as a photo does.
  const scanned = new Map<string, boolean>();
  const isScan = async (sourceId: string, bytes: Buffer) => {
    if (!scanned.has(sourceId)) {
      const text = await readPdf(bytes).then((r) => r.pages.join("").trim()).catch(() => "");
      scanned.set(sourceId, text.length <= 40);
    }
    return scanned.get(sourceId)!;
  };

  const built: BuiltPage[] = [];
  for (const [i, page] of intake.pages.entries()) {
    const bytes = await bytesOf(page.sourceId);
    if (page.kind === "pdf-page") {
      const picture = (await isScan(page.sourceId, bytes))
        ? (await pagesAsImages(bytes, { only: page.sourcePage }).catch(() => []))[0]
        : undefined;
      built.push({
        kind: "pdf",
        source: bytes,
        index: page.sourcePage,
        rotation: page.rotation,
        text: picture ? await textLayer(picture.png) : null,
      });
      continue;
    }
    const image = await renderImagePage(bytes, { ...page, position: i + 1 });
    built.push({
      kind: "image",
      bytes: image.bytes,
      format: image.format,
      mm: image.mm,
      original: image.isOriginal ? undefined : { bytes, mime: page.mime, name: `page-${i + 1}-original.${extensionOf(page.mime)}` },
      // Searchable in any viewer, not only here (D39).
      text: await textLayer(image.bytes),
    });
  }

  const pdf = await buildPdf(intake.title, built);
  await checkPdf(pdf.bytes, pdf.expected);

  // A conversion files the PDF as the record's next version (D39, D20); the
  // image version before it stays as history. Anything else is a new record.
  const filed = intake.recordId
    ? await fileVersion(db, intake.recordId, { mime: "application/pdf", bytes: pdf.bytes })
    : await fileDocument(db, {
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

  const released = await discardIntake(db, intakeId);
  // Under the lock above this cannot happen; if it ever does, file nothing.
  if (released.length === 0) throw new UploadRefused("This draft has already been filed or thrown away.");
  return { documentId: filed.documentId, released };
}

/* ------------------------------------------------------------------ */
/* Converting what was filed before D39                                */
/* ------------------------------------------------------------------ */

/**
 * Current documents the caller can see that still hold an image rather than a
 * PDF, and are not already being converted in a draft the caller reaches.
 * Only meaningful for somebody who may file; the route asks only for them.
 */
export async function convertible(db: VaultTransaction) {
  const rows = await db.execute<{ documentId: string; title: string; ownerName: string | null; pages: number }>(sql`
    select d.id as "documentId", r.title, o.display_name as "ownerName",
           (select count(*)::int from document_files f where f.document_id = d.id) as pages
    from documents d
    join records r on r.id = d.record_id
    left join owners o on o.id = r.owner_id
    where d.is_current
      and exists (select 1 from document_files f where f.document_id = d.id and f.mime <> 'application/pdf')
      and not exists (select 1 from intakes i where i.record_id = r.id)
    order by o.display_name, r.title
  `);
  return [...rows];
}

/**
 * Open a draft from a filed document: its pages copied in (decrypted from the
 * vault and sealed again under the draft), its details carried over, the
 * record it will become the next version of remembered. Nothing in the vault
 * changes until the draft is filed.
 */
export async function convertDocument(db: VaultTransaction, createdBy: string, documentId: string): Promise<string> {
  const view = await findRecordView(db, documentId);
  if (!view || !view.document.isCurrent) throw new Response("No such document.", { status: 404 });

  const pages = [];
  for (const page of view.pages) {
    if (page.mime === "image/heic" || page.mime === "image/heif") {
      throw new UploadRefused("A page of this one is a HEIC photo, which cannot be converted here. Upload it again as a JPEG.");
    }
    const row = await findFile(db, page.id);
    if (!row) throw new Response("No such document.", { status: 404 });
    // A file that will not open (a key that is gone, a blob that does not
    // match its digest) is said plainly, not thrown as a server error.
    const bytes = await readFileContents(row).catch(() => {
      throw new UploadRefused("A page of this one cannot be opened, so it cannot be converted.");
    });
    for (const one of await splitPages({ mime: page.mime, bytes })) {
      pages.push({ ...one, examined: await examine(one.bytes, one.mime) });
    }
  }

  const ownerRow = [...(await db.execute<{ ownerId: string | null }>(sql`select owner_id as "ownerId" from records where id = ${view.recordId}`))][0];
  const id = await startIntake(db, createdBy, {
    ownerId: ownerRow?.ownerId ?? null,
    category: view.category,
    title: view.title,
    recordId: view.recordId,
    baseDocumentId: documentId,
  });
  for (const page of pages) await addSource(db, id, page, page.examined);

  // What was on file comes along, as it stood: confirmed values as a person's,
  // the rest as the reader's.
  const d = view.document;
  const was: Partial<Record<EditableField, string | null>> = {
    document_date: d.documentDate,
    issued_on: d.issuedOn,
    expires_on: d.expiresOn,
    issuer_country: d.issuerCountry,
    place_of_issue: d.placeOfIssue,
    original_location_note: d.originalLocationNote,
  };
  const values: IntakeView["values"] = {};
  for (const [field, value] of Object.entries(was) as [EditableField, string | null][]) {
    if (value) values[field] = { value, source: d.confirmedFields.includes(field) ? "person" : "page-text" };
  }
  let identifier: Buffer | null = null;
  if (d.hasIdentifier) {
    const [{ sealed }] = [...(await db.execute<{ sealed: Buffer }>(sql`select identifier_sealed as sealed from documents where id = ${documentId}`))];
    identifier = sealIdentifier(openIdentifier(Buffer.from(sealed), documentId), id);
    values.identifier = { source: d.confirmedFields.includes("identifier") ? "person" : "page-text", masked: true };
  }
  await db.execute(sql`
    update intakes set fields = ${JSON.stringify({ values, how: "Carried over from the version already filed." })}::jsonb,
      identifier_sealed = ${identifier}
    where id = ${id}
  `);
  return id;
}

/**
 * Stop a draft filing over a version its filer has not seen (D42).
 *
 * The record's current version must be the one the draft started from, or the
 * newer one the person was shown and said to file over. Anything else, and
 * what is current now is handed back to be shown. A version the person cannot
 * see is no version here: it produces no row, so it cannot be compared and
 * cannot stop anything, which says nothing about it either.
 *
 * ponytail: checked, then filed, in one transaction without a lock. Two
 * people pressing File it in the same instant can both pass; the unique
 * version number still keeps them apart. Lock the record's row if that ever
 * matters.
 */
async function checkStillNewest(db: VaultTransaction, recordId: string, base: string | null, over?: string): Promise<void> {
  const [current] = [
    ...(await db.execute<{ id: string }>(sql`select id from documents where record_id = ${recordId} and is_current`)),
  ];
  if (!current || current.id === base || current.id === over) return;
  throw new NewerVersion(current.id);
}

function extensionOf(mime: string): string {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/tiff": "tiff" }[mime] ?? "bin";
}
