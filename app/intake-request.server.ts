/**
 * Uploads into a draft, then read (D40). Shared by single upload, bulk, and
 * adding pages to a draft already open.
 *
 * The slow parts run outside any transaction: working out what an upload holds
 * (OpenCV on a photo) before, and reading the pages (Tesseract, seconds a page)
 * after. Each touches no rows. The writes between them are one transaction.
 */

import { readSafely } from "./bulk.server";
import {
  addSource,
  examine,
  type Examined,
  readablePages,
  saveRead,
  splitPages,
  startIntake,
} from "./intake.server";
import { withVault } from "./session.server";

export type Upload = { mime: string; bytes: Buffer };

/** Read every page of a draft and save what the reader proposed. */
export async function readInto(request: Request, intakeId: string): Promise<{ proposed: number }> {
  const pages = await withVault(request, (db) => readablePages(db, intakeId));
  const reads: Awaited<ReturnType<typeof readSafely>>[] = [];
  for (const page of pages) reads.push(await readSafely(page.bytes, page.mime));
  const proposed = await withVault(request, (db) => saveRead(db, intakeId, reads));
  return { proposed };
}

/** Uploads into an existing draft, or a new one when `intakeId` is absent. Then read. */
export async function draftFromUploads(
  request: Request,
  uploads: Upload[],
  target: { intakeId: string } | { init: Parameters<typeof startIntake>[2] },
): Promise<{ intakeId: string; proposed: number }> {
  // Every upload is examined before anything is written, so one bad file in a
  // batch refuses the batch rather than leaving half a draft.
  uploads = (await Promise.all(uploads.map(splitPages))).flat();
  const examined: Examined[] = [];
  for (const upload of uploads) examined.push(await examine(upload.bytes, upload.mime));

  const intakeId = await withVault(request, async (db, user) => {
    const id = "intakeId" in target ? target.intakeId : await startIntake(db, user.id, target.init);
    for (const [i, upload] of uploads.entries()) await addSource(db, id, upload, examined[i]);
    return id;
  });

  return { intakeId, ...(await readInto(request, intakeId)) };
}

/** A permission refusal reads as a database error; this says whether one was. */
export function refusedByPolicy(error: unknown): boolean {
  return (error as { cause?: { code?: string } })?.cause?.code === "42501";
}
