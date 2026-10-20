/**
 * The reader, made safe to call on anything a person uploads (Step 15).
 *
 * Bulk intake used to file each file here directly. Since D40 every upload is
 * a draft first (`intake-request.server.ts`), and this is what is left: the
 * reader runs outside any transaction, and a reader that falls over costs the
 * draft its proposals, never the draft.
 */

import { readDocument, type ReadResult } from "./ocr.server";

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
