/**
 * Bulk intake: one file, read, then filed with what was read (Step 15).
 *
 * The reader runs first, on the uploaded bytes, outside any transaction: it is
 * slow (Tesseract takes seconds a page) and it touches nothing. Then the
 * document and its proposals go in together, in the caller's transaction, so a
 * document never lands half-read and a refusal leaves nothing behind.
 *
 * Who may file for whom is the database's call, exactly as for one upload
 * (`records_write`, 0005). Nothing here checks it.
 */

import type { VaultTransaction } from "./db.server";
import { untitled, type Category } from "./documents";
import { readDocument, type ReadResult } from "./ocr.server";
import { saveExtraction, saveProposals } from "./record.server";
import { deleteBlob, storageKeyFor } from "./storage.server";
import { fileDocument, type Filing } from "./upload.server";

export type Intake = {
  documentId: string;
  /** How many fields the reader filled in, all unconfirmed (D26). */
  proposed: number;
  /** The reader's own sentence about how it read, or why it could not. */
  how: string;
};

/** The reader, or null if it fell over. A document is never lost to its reader. */
export async function readSafely(
  bytes: Buffer,
  mime: string,
  read: (bytes: Buffer, mime: string) => Promise<ReadResult> = readDocument,
): Promise<ReadResult | null> {
  try {
    return await read(bytes, mime);
  } catch {
    // Not logged: the error could quote what it was reading.
    return null;
  }
}

export async function fileAndRead(
  db: VaultTransaction,
  filing: Filing,
  read: ReadResult | null,
): Promise<Intake> {
  const title = filing.title.trim() || untitled(filing.category as Category);
  const filed = await fileDocument(db, { ...filing, title });

  try {
    const saved = read
      ? await saveProposals(db, filed.documentId, read.proposals)
      : { written: [] };
    if (read?.terms) await saveExtraction(db, filed.documentId, read.terms);

    return {
      documentId: filed.documentId,
      proposed: saved.written.length,
      how: read?.how ?? "The reader could not open this one. Filed with nothing filled in.",
    };
  } catch (error) {
    // The transaction takes the rows back; the blob is already on disk and
    // would otherwise sit there with nothing pointing at it.
    await deleteBlob(storageKeyFor(filed.fileId)).catch(() => {});
    throw error;
  }
}
