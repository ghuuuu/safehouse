/**
 * Handing a document back, decrypted, to somebody entitled to it.
 *
 * This is where the one rule stops being about lists and starts being about
 * bytes. Everything the vault has shown until now is a title and an owner's
 * name; this returns the scan itself.
 *
 * The entitlement question is answered by the same policy as everywhere else:
 * the row is read inside the caller's transaction, so `document_files_read`
 * decides whether there is a row at all. A file the caller may not see does not
 * come back as a forbidden row — it comes back as no row, and this module
 * cannot tell the difference between that and a file that was never there,
 * which is the correct amount for it to know.
 *
 * Nothing here logs a file name, a title, or a storage key (CLAUDE.md).
 */

import { sql } from "drizzle-orm";

import { openFile } from "./crypto.server";
import type { VaultTransaction } from "./db.server";
import { getBlob } from "./storage.server";

export type StoredFile = {
  id: string;
  mime: string;
  byteSize: number;
  sha256: string;
  pageNo: number;
  /** For the download name. Never the uploaded file's own name — it is not kept. */
  title: string;
};

type Row = StoredFile & { storageKey: string; wrappedDek: Buffer; nonce: Buffer };

/**
 * Read one file's row, if the policies allow it.
 *
 * Separate from opening it so a caller can answer "does this exist for me"
 * without decrypting anything.
 */
export async function findFile(
  db: VaultTransaction,
  fileId: string,
): Promise<Row | null> {
  const rows = await db.execute<Row>(sql`
    select f.id, f.mime, f.byte_size as "byteSize", f.sha256, f.page_no as "pageNo",
           f.storage_key as "storageKey", f.wrapped_dek as "wrappedDek", f.nonce,
           r.title
    from document_files f
    join documents d on d.id = f.document_id
    join records r on r.id = d.record_id
    where f.id = ${fileId}
  `);

  return [...rows][0] ?? null;
}

/**
 * The plaintext, verified.
 *
 * `openFile` authenticates before it returns anything, and the sha256 is
 * checked afterwards as well. The two answer different questions: the tag says
 * nobody tampered with these bytes under this key, and the digest says these
 * are the bytes that were uploaded. A restore that silently swapped one
 * document's blob for an older copy of itself would pass the first and fail the
 * second.
 */
export async function readFileContents(row: Row): Promise<Buffer> {
  const stored = await getBlob(row.storageKey);
  const plaintext = openFile(
    {
      stored,
      nonce: Buffer.from(row.nonce),
      wrappedDek: Buffer.from(row.wrappedDek),
    },
    row.id,
  );

  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(plaintext).digest("hex");

  if (digest !== row.sha256) {
    throw new Error(`File ${row.id} does not match the digest recorded for it.`);
  }

  return plaintext;
}

/** A filename for the browser, built from the record's title and nothing else. */
export function downloadName(row: StoredFile): string {
  const extension =
    {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
      "image/tiff": "tiff",
    }[row.mime] ?? "bin";

  // Letters, numbers, spaces, dots and hyphens survive; runs of dots collapse
  // and leading ones are dropped, so a title of "../../etc/passwd" cannot
  // arrive as a hidden file or a path.
  const safe =
    row.title
      .replace(/[^\p{L}\p{N} .-]/gu, "")
      .replace(/\.{2,}/g, ".")
      .replace(/^[.\s-]+|[.\s-]+$/g, "") || "document";
  const page = row.pageNo > 1 ? `-${row.pageNo}` : "";

  return `${safe}${page}.${extension}`;
}
