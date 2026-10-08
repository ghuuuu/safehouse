/**
 * One record, its versions, its pages, and the fields that make it more than a
 * picture.
 *
 * The masking rule is the load-bearing part. The passport number is stored
 * sealed (`identifier_sealed`, D35), and PRODUCT.md says sensitive fields are
 * masked until explicitly revealed. CLAUDE.md says what that has to mean:
 * masked in the interface means **absent from the payload**, not hidden in
 * CSS. So nothing here opens it on the ordinary path — the screen is told
 * whether there is one, never what it is — and revealing it is a second
 * request that costs a password check and a line in the log.
 *
 * Everything else about who sees what is decided where it always is: these
 * queries carry no permission logic, and a document the viewer may not see
 * produces no row.
 */

import { sql } from "drizzle-orm";

import { ACTIONS, record as logEvent } from "./activity.server";
import type { VaultTransaction } from "./db.server";
import { identifierColumns, openIdentifier } from "./field-crypto.server";

/** The fields a person may fill in or correct. */
export const EDITABLE_FIELDS = [
  "document_date",
  "issued_on",
  "expires_on",
  "issuer_country",
  "place_of_issue",
  "original_location_note",
  "identifier",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Masked everywhere until asked for by name, with a password behind it. */
export const MASKED_FIELDS: EditableField[] = ["identifier"];

export type Version = {
  id: string;
  versionNo: number;
  isCurrent: boolean;
  documentDate: string | null;
  expiresOn: string | null;
  /** Whether that date has passed, by the database's clock. */
  expired: boolean;
  pageCount: number;
};

export type Page = { id: string; pageNo: number; mime: string; byteSize: number };

export type RecordView = {
  recordId: string;
  title: string;
  category: string;
  subcategory: string | null;
  isPrivate: boolean;
  /** Null when the viewer reached the record without reaching its owner (D17). */
  ownerName: string | null;
  document: {
    id: string;
    versionNo: number;
    isCurrent: boolean;
    documentDate: string | null;
    issuedOn: string | null;
    expiresOn: string | null;
    issuerCountry: string | null;
    placeOfIssue: string | null;
    originalLocationNote: string | null;
    /** Whether a number is on file. Never the number itself. */
    hasIdentifier: boolean;
    confirmedFields: string[];
  };
  /** What the reader last made of this document. Never authoritative (D26). */
  extraction: Record<string, unknown>;
  pages: Page[];
  versions: Version[];
};

export async function findRecordView(
  db: VaultTransaction,
  documentId: string,
): Promise<RecordView | null> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select
      r.id as "recordId", r.title, r.category, r.is_private as "isPrivate",
      s.label as subcategory,
      o.display_name as "ownerName",
      d.id as "documentId", d.version_no as "versionNo", d.is_current as "isCurrent",
      d.document_date as "documentDate", d.issued_on as "issuedOn",
      d.expires_on as "expiresOn", d.issuer_country as "issuerCountry",
      d.place_of_issue as "placeOfIssue",
      d.original_location_note as "originalLocationNote",
      -- Whether, never what. The number itself never joins this payload.
      (d.identifier_sealed is not null) as "hasIdentifier",
      d.confirmed_fields as "confirmedFields",
      d.extraction
    from documents d
    join records r on r.id = d.record_id
    left join owners o on o.id = r.owner_id
    left join subcategories s on s.id = r.subcategory_id
    where d.id = ${documentId}
  `);

  const row = [...rows][0];
  if (!row) return null;

  const pages = await db.execute<Page>(sql`
    select id, page_no as "pageNo", mime, byte_size as "byteSize"
    from document_files
    where document_id = ${documentId}
    order by page_no
  `);

  // Every version of the same record the viewer may see. A superseded version
  // stays visible to whoever can see the record (D20).
  const versions = await db.execute<Version>(sql`
    select
      d.id, d.version_no as "versionNo", d.is_current as "isCurrent",
      d.document_date as "documentDate", d.expires_on as "expiresOn",
      coalesce(d.expires_on < current_date, false) as "expired",
      (select count(*)::int from document_files f where f.document_id = d.id) as "pageCount"
    from documents d
    where d.record_id = ${row.recordId as string}
    order by d.version_no desc
  `);

  return {
    recordId: row.recordId as string,
    title: row.title as string,
    category: row.category as string,
    subcategory: (row.subcategory as string | null) ?? null,
    isPrivate: row.isPrivate as boolean,
    ownerName: (row.ownerName as string | null) ?? null,
    document: {
      id: row.documentId as string,
      versionNo: row.versionNo as number,
      isCurrent: row.isCurrent as boolean,
      documentDate: asDate(row.documentDate),
      issuedOn: asDate(row.issuedOn),
      expiresOn: asDate(row.expiresOn),
      issuerCountry: (row.issuerCountry as string | null) ?? null,
      placeOfIssue: (row.placeOfIssue as string | null) ?? null,
      originalLocationNote: (row.originalLocationNote as string | null) ?? null,
      hasIdentifier: row.hasIdentifier as boolean,
      confirmedFields: (row.confirmedFields as string[]) ?? [],
    },
    extraction: (row.extraction as Record<string, unknown>) ?? {},
    pages: [...pages],
    versions: [...versions],
  };
}

function asDate(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

/**
 * Save what a person typed.
 *
 * Anything given a value here is confirmed by the same act — a human looked at
 * the document and wrote this down. That is what distinguishes it from a value
 * a reader will one day propose, which arrives unconfirmed and stays that way
 * until somebody agrees with it (D26).
 *
 * A field cleared to empty becomes null and loses its confirmation, because
 * "nobody has said" and "somebody said it is nothing" should not look alike.
 */
export async function saveFields(
  db: VaultTransaction,
  documentId: string,
  values: Partial<Record<EditableField, string>>,
): Promise<void> {
  const given = EDITABLE_FIELDS.filter((field) => field in values);
  if (given.length === 0) return;

  const confirmed = given.filter((field) => (values[field] ?? "").trim() !== "");
  const cleared = given.filter((field) => (values[field] ?? "").trim() === "");

  const assignments = given.map((field) => {
    const value = (values[field] ?? "").trim();
    if (field === "identifier") return sealedAssignment(value, documentId);

    const next = value === "" ? sql`null` : sql`${value}`;

    // Dates have to be cast; everything else is text already.
    const typed = DATE_FIELDS.has(field) ? sql`${next}::date` : next;
    return sql`${sql.raw(field)} = ${typed}`;
  });

  // Both lists arrive as jsonb rather than as a Postgres array, because an
  // empty text[] parameter renders as `()` and is a syntax error — and the
  // empty case is the ordinary one here.
  await db.execute(sql`
    update documents
    set ${sql.join(assignments, sql`, `)},
        confirmed_fields = (
          select coalesce(jsonb_agg(distinct f), '[]'::jsonb)
          from jsonb_array_elements_text(
            confirmed_fields || ${JSON.stringify(confirmed)}::jsonb
          ) as f
          where f not in (
            select jsonb_array_elements_text(${JSON.stringify(cleared)}::jsonb)
          )
        )
    where id = ${documentId}
  `);
}

/**
 * The identifier is never written as itself: three columns, sealed and
 * fingerprinted, and an empty value clears all three (D35). Sealed under the
 * document's id, so this is the only shape of write that can produce a value
 * the reveal will open.
 */
function sealedAssignment(value: string, documentId: string) {
  const columns = identifierColumns(value || null, documentId);
  return sql`identifier_sealed = ${columns.sealed}, identifier_fp = ${columns.fp},
    identifier_last4_fp = ${columns.last4}`;
}

const DATE_FIELDS = new Set<EditableField>([
  "document_date",
  "issued_on",
  "expires_on",
]);

/**
 * The masked value, for one request, at a price.
 *
 * The caller is responsible for having demanded a step-up check first. The log
 * line goes in before the value comes out, in the same transaction, so a reveal
 * that could not be recorded does not happen (D14).
 */
export async function revealIdentifier(
  db: VaultTransaction,
  documentId: string,
): Promise<string | null> {
  await logEvent(db, {
    action: ACTIONS.fieldRevealed,
    subjectType: "document",
    subjectId: documentId,
  });

  const rows = await db.execute<{ sealed: Buffer | null }>(
    sql`select identifier_sealed as sealed from documents where id = ${documentId}`,
  );

  const sealed = [...rows][0]?.sealed;
  return sealed ? openIdentifier(sealed, documentId) : null;
}

/**
 * Write what the reader proposed, without claiming anybody believes it.
 *
 * Two rules, and the first one is the whole point of `confirmed_fields`
 * existing. A proposal never overwrites a value a person has confirmed — the
 * machine does not get to correct the human. And it never marks anything
 * confirmed, so an expiry date the reader found cannot reach a reminder until
 * somebody has looked at it (D26).
 *
 * It does overwrite an earlier unconfirmed proposal, because re-reading a
 * document with a better scan should be able to improve on a bad guess.
 */
export async function saveProposals(
  db: VaultTransaction,
  documentId: string,
  proposals: { field: string; value: string }[],
): Promise<{ written: string[]; keptBecauseConfirmed: string[] }> {
  const usable = proposals.filter((p) =>
    (EDITABLE_FIELDS as readonly string[]).includes(p.field),
  );

  if (usable.length === 0) return { written: [], keptBecauseConfirmed: [] };

  const rows = await db.execute<{ confirmedFields: string[] }>(
    sql`select confirmed_fields as "confirmedFields" from documents where id = ${documentId}`,
  );

  const confirmed = new Set([...rows][0]?.confirmedFields ?? []);
  const toWrite = usable.filter((p) => !confirmed.has(p.field));

  if (toWrite.length > 0) {
    const assignments = toWrite.map((p) => {
      if (p.field === "identifier") return sealedAssignment(p.value.trim(), documentId);
      const value = DATE_FIELDS.has(p.field as EditableField)
        ? sql`${p.value}::date`
        : sql`${p.value}`;
      return sql`${sql.raw(p.field)} = ${value}`;
    });

    await db.execute(sql`
      update documents set ${sql.join(assignments, sql`, `)} where id = ${documentId}
    `);
  }

  return {
    written: toWrite.map((p) => p.field),
    keptBecauseConfirmed: usable
      .filter((p) => confirmed.has(p.field))
      .map((p) => p.field),
  };
}

/**
 * Store the reader's working notes.
 *
 * A proposal for a masked field keeps its provenance and loses its value. The
 * number itself is sealed into `identifier_sealed`, where seeing it costs a
 * password check and a line in the log (D35); leaving a copy in a column the
 * Record screen renders would hand it straight back past both, and in the
 * clear.
 */
export async function saveExtraction(
  db: VaultTransaction,
  documentId: string,
  extraction: { proposals: { field: string; value: string }[] } & Record<string, unknown>,
): Promise<void> {
  const safe = {
    ...extraction,
    proposals: extraction.proposals.map((proposal) =>
      MASKED_FIELDS.includes(proposal.field as EditableField)
        ? { ...proposal, value: undefined, masked: true }
        : proposal,
    ),
  };

  await db.execute(sql`
    update documents set extraction = ${JSON.stringify(safe)}::jsonb
    where id = ${documentId}
  `);
}
