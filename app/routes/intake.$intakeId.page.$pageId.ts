import type { Route } from "./+types/intake.$intakeId.page.$pageId";
import { pagePreview } from "../intake.server";
import { withVault } from "../session.server";
import { requireStepUp } from "../stepup.server";

/**
 * One page of a draft, for the review screen: a photo flattened as it will be
 * filed (`?view=flat`) or as photographed (`?view=photo`, for the corner
 * editor), or a page of an uploaded PDF as a one-page PDF.
 *
 * How it enforces access: `withVault`, so `intakes_reach` decides whether the
 * draft exists for this person (its uploader or an admin, D40); then a recent
 * password check, because these are the papers themselves (D4). Shown inline,
 * since an image tag cannot show an attachment, and never cached.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    await requireStepUp(request, user);
    const url = new URL(request.url);
    const view = url.searchParams.get("view") === "photo" ? "photo" : "flat";
    const max = Math.min(2000, Math.max(200, Number(url.searchParams.get("max")) || 1200));

    const page = await pagePreview(db, params.intakeId, params.pageId, view, max);
    if (!page) throw new Response("No such page.", { status: 404 });

    return new Response(new Uint8Array(page.bytes), {
      headers: {
        "content-type": page.type,
        "content-length": String(page.bytes.length),
        "content-disposition": "inline",
        "cache-control": "private, no-store, max-age=0",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
