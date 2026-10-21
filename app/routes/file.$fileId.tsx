import type { Route } from "./+types/file.$fileId";
import {
  contentDisposition,
  downloadName,
  findFile,
  readFileContents,
} from "../download.server";
import { ACTIONS, record } from "../activity.server";
import { withVault } from "../session.server";
import { requireStepUp } from "../stepup.server";

/**
 * How this surface enforces access.
 *
 * Three gates, in this order, and the order is the point.
 *
 * 1. `withVault` turns the cookie into a named transaction. No cookie, no
 *    transaction, and the request is a redirect before anything else runs.
 * 2. `requireStepUp` demands a password check inside the last few minutes
 *    (D4). It throws a redirect, so a loader that ignored the result would
 *    still not reach the bytes.
 * 3. The row is read inside that transaction, so `document_files_read` decides
 *    whether it exists. A file this person may not see produces no row, and
 *    this route cannot tell that from a file that was never there — which is
 *    the correct amount for it to know. Both answer 404.
 *
 * Only then is anything decrypted. There is no path through this file where
 * bytes are read from disk before all three have been satisfied.
 *
 * Deliberately not reachable while viewing as somebody else: the viewed
 * transaction is read-only and this route uses `withVault`, so an admin
 * borrowing eyes sees the list that person sees and downloads as themselves or
 * not at all.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    await requireStepUp(request, user);

    const row = await findFile(db, params.fileId);

    if (!row) {
      throw new Response("No such file.", { status: 404 });
    }

    // Inside the same transaction as the read, and before the bytes exist as
    // a response. If this write fails the download fails with it, which is the
    // only way "every download is recorded" is true rather than aspirational.
    await record(db, {
      action: ACTIONS.documentDownloaded,
      subjectType: "document_file",
      subjectId: row.id,
    });

    const bytes = await readFileContents(row);

    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": row.mime,
        "content-length": String(bytes.length),
        // `attachment` rather than `inline`: a PDF rendered in the tab is a
        // PDF the browser may cache, hand to a plugin, or print to a service.
        "content-disposition": contentDisposition(downloadName(row)),
        // The vault's whole job is to be the only copy that matters.
        "cache-control": "private, no-store, max-age=0",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
