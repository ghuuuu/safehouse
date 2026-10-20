/**
 * Filing a document: the first thing this application ever writes.
 *
 * One upload becomes three rows and one sealed blob. Every file belongs to a
 * document and every document belongs to a record (D20), so a file arriving on
 * its own creates the record it needs rather than being allowed to float — the
 * vault list stays one query instead of a union of records and loose files.
 *
 * What stops a bad upload is in three places, and it matters which:
 *
 *   The database decides *whose* drawer this may go in. The policies in
 *   `0005_write_policies.sql` refuse an owner the filer cannot already see,
 *   and that refusal happens before a single byte reaches the disk, because
 *   the rows are inserted first and the blob is written afterwards.
 *
 *   This module decides what is *acceptable to hold* — a size ceiling and a
 *   type allowlist. Those are not permission questions and do not belong in a
 *   policy.
 *
 *   `crypto.server.ts` decides what lands on disk, which is never the file
 *   that was uploaded.
 */

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import {
  ACCEPTED_TYPES,
  CATEGORIES,
  MAX_UPLOAD_BYTES,
  type Category,
} from "./documents";
import { ACTIONS, record } from "./activity.server";
import { sealFile } from "./crypto.server";
import type { VaultTransaction } from "./db.server";
import { deleteBlob, putBlob, storageKeyFor } from "./storage.server";

export type Filing = {
  ownerId: string;
  category: Category;
  /** What the record is called. The file's own name is never stored. */
  title: string;
  mime: string;
  bytes: Buffer;
};

export type Filed = {
  recordId: string;
  documentId: string;
  fileId: string;
};

/** Thrown for a refusal the person can fix. Never for a permission refusal. */
export class UploadRefused extends Error {}

export function checkFiling(filing: {
  title: string;
  mime: string;
  size: number;
  ownerId: string;
  category: string;
}): asserts filing is { title: string; mime: string; size: number; ownerId: string; category: Category } {
  if (filing.size === 0) {
    throw new UploadRefused("That file is empty.");
  }

  if (filing.size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);
    throw new UploadRefused(`Files are limited to ${mb} MB.`);
  }

  if (!ACCEPTED_TYPES.includes(filing.mime as (typeof ACCEPTED_TYPES)[number])) {
    // Named rather than listed back, so the message does not become a catalogue
    // of what to try next.
    throw new UploadRefused("That file type cannot be stored here. PDF or an image.");
  }

  if (filing.title.trim() === "") {
    throw new UploadRefused("Give the document a name.");
  }

  if (filing.title.length > 200) {
    throw new UploadRefused("That name is too long.");
  }

  if (!CATEGORIES.includes(filing.category as Category)) {
    throw new UploadRefused("Pick a category.");
  }

  if (!UUID.test(filing.ownerId)) {
    throw new UploadRefused("Pick who this belongs to.");
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * File one document, a new record, inside the caller's transaction. The record
 * and document rows go in before the file, so a filer who may not write to
 * this owner is refused before anything is encrypted (`insertFile`).
 */
export async function fileDocument(
  db: VaultTransaction,
  filing: Filing,
): Promise<Filed> {
  checkFiling({ ...filing, size: filing.bytes.length });

  const recordId = randomUUID();
  const documentId = randomUUID();

  await db.execute(sql`
    insert into records (id, owner_id, category, kind, title, is_private)
    values (${recordId}, ${filing.ownerId}, ${filing.category}, 'document', ${filing.title}, false)
  `);

  await db.execute(sql`
    insert into documents (id, record_id, version_no, is_current)
    values (${documentId}, ${recordId}, 1, true)
  `);

  const fileId = await insertFile(db, documentId, filing.mime, filing.bytes);
  return { recordId, documentId, fileId };
}

/**
 * File a new version of a record already in the vault (D20), and make it the
 * current one. Called with a PDF the vault built and checked itself (D39), so
 * there is no upload to vet here. The previous version is superseded, never deleted: it stays in
 * the record's history for whoever can see the record.
 *
 * `documents_write` refuses a record the filer cannot see, and
 * `documents_update` the flip of `is_current`, so this decides nothing about
 * who may. The old version is unmarked before the new one is marked, because
 * only one version of a record may be current at a time.
 */
export async function fileVersion(
  db: VaultTransaction,
  recordId: string,
  file: { mime: string; bytes: Buffer },
): Promise<Filed> {
  const documentId = randomUUID();
  await db.execute(sql`
    insert into documents (id, record_id, version_no, is_current)
    values (
      ${documentId}, ${recordId},
      (select coalesce(max(version_no), 0) + 1 from documents where record_id = ${recordId}),
      false
    )
  `);
  const fileId = await insertFile(db, documentId, file.mime, file.bytes);

  await db.execute(sql`update documents set is_current = false where record_id = ${recordId} and is_current`);
  const made = await db.execute(sql`update documents set is_current = true where id = ${documentId} returning 1`);
  if (made.length === 0) throw new Error("The new version could not be made current.");

  return { recordId, documentId, fileId };
}

/**
 * One sealed file under a document, and the line saying it was filed.
 *
 * The rows go in first, so a filer who may not write here is refused by the
 * database before anything is encrypted or written to disk. The blob is
 * written last, inside the same transaction, so a disk that is full or
 * unwritable takes the rows back with it.
 *
 * What survives a crash between the blob write and the commit is one sealed
 * file nothing points at: unreadable, inert, and removable by anything that
 * ever walks the store. The opposite order would leave a row pointing at
 * nothing, which is a document that has disappeared.
 */
async function insertFile(db: VaultTransaction, documentId: string, mime: string, bytes: Buffer): Promise<string> {
  const fileId = randomUUID();
  const storageKey = storageKeyFor(fileId);
  const sealed = sealFile(bytes, fileId);

  await db.execute(sql`
    insert into document_files
      (id, document_id, page_no, storage_key, sha256, byte_size, mime, wrapped_dek, nonce)
    values (
      ${fileId}, ${documentId}, 1, ${storageKey}, ${sealed.sha256},
      ${sealed.byteSize}, ${mime}, ${sealed.wrappedDek}, ${sealed.nonce}
    )
  `);

  try {
    await putBlob(storageKey, sealed.stored);
  } catch (error) {
    // The transaction will roll the rows back; this stops a partial write from
    // sitting in the store under a key a later upload could be given.
    await deleteBlob(storageKey).catch(() => {});
    throw error;
  }

  await record(db, {
    action: ACTIONS.documentFiled,
    subjectType: "document",
    subjectId: documentId,
  });

  return fileId;
}
