import type { Route } from "./+types/bulk.file";
import { untitled, type Category, CATEGORIES } from "../documents";
import { draftFromUploads, refusedByPolicy } from "../intake-request.server";
import { requireUser } from "../session.server";
import { UploadRefused } from "../upload.server";

/**
 * One file of a bulk intake, made into its own draft and read (D40). A
 * resource route: it answers in JSON, so the page can send files one at a time
 * and show each one's outcome. Nothing is filed here; each draft is finished
 * from the Unfinished list.
 *
 * How it enforces access: `withVault` (inside `draftFromUploads`), and
 * `intakes_start`, which refuses a draft for an owner out of reach or by
 * somebody who may not file. The role check below only saves a third party's
 * upload from being examined for nothing. The answer never carries a field
 * value, only how many were proposed.
 */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  if (user.role !== "admin" && user.role !== "individual") {
    return Response.json({ error: "Your account can read the vault but not add to it." }, { status: 403 });
  }

  const form = await request.formData();
  const upload = form.get("file");
  if (!(upload instanceof File)) {
    return Response.json({ error: "Choose a file." }, { status: 400 });
  }

  const category = String(form.get("category") ?? "");
  const title = String(form.get("title") ?? "").trim();

  try {
    const draft = await draftFromUploads(request, [{ mime: upload.type, bytes: Buffer.from(await upload.arrayBuffer()) }], {
      init: {
        ownerId: String(form.get("ownerId") ?? "") || null,
        category,
        // A blank title becomes "<Category> document", never the file's name.
        title: title || (CATEGORIES.includes(category as Category) ? untitled(category as Category) : null),
      },
    });
    return Response.json(draft);
  } catch (error) {
    if (error instanceof UploadRefused) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (refusedByPolicy(error)) {
      return Response.json({ error: "You cannot file a document for that owner." }, { status: 403 });
    }
    throw error;
  }
}
