import { redirect } from "react-router";

import type { Route } from "./+types/folders.download";
import { DownloadRefused, zipDocuments } from "../folders.server";
import { withVault } from "../session.server";
import { requireStepUp } from "../stepup.server";

/**
 * The chosen documents as one ZIP (D41).
 *
 * How this surface enforces access, in the order `/file/:id` uses: `withVault`
 * names the transaction; `requireStepUp` asks for a recent password (D4);
 * then every id is read through the policies, and one the caller cannot see
 * refuses the whole download (`zipDocuments`). Every file is recorded as
 * downloaded before its bytes are read.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const ids = form.getAll("documentId").map(String);

  return withVault(request, async (db, user) => {
    await requireStepUp(request, user);
    try {
      const zip = await zipDocuments(db, ids);
      return new Response(new Uint8Array(zip), {
        headers: {
          "content-type": "application/zip",
          "content-length": String(zip.length),
          "content-disposition": `attachment; filename="SafeHouse.zip"`,
          "cache-control": "private, no-store, max-age=0",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof DownloadRefused) {
        return redirect(`/folders?refused=${encodeURIComponent(error.message)}`);
      }
      throw error;
    }
  });
}

/**
 * Where the password check sends somebody back to after confirming. The choice
 * they made was a form post and is gone, so back to the folders to make it again.
 */
export function loader() {
  return redirect("/folders?confirmed");
}
