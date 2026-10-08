import type { Route } from "./+types/bulk.file";
import { fileAndRead, readSafely } from "../bulk.server";
import { requireUser, withVault } from "../session.server";
import { checkFiling, UploadRefused } from "../upload.server";

/**
 * One file of a bulk intake. A resource route: it answers in JSON, so the page
 * can send files one at a time and show each one's outcome.
 *
 * How it enforces access: `withVault`, and `records_write` on the insert. The
 * role check below only saves a third party's upload from being read for
 * nothing; the database refuses them either way. The answer never carries a
 * field value, only how many were proposed.
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

  const bytes = Buffer.from(await upload.arrayBuffer());
  const filing = {
    ownerId: String(form.get("ownerId") ?? ""),
    category: String(form.get("category") ?? "") as never,
    title: String(form.get("title") ?? ""),
    mime: upload.type,
    bytes,
  };

  try {
    // Refused before the slow part, so a file that cannot be held is not read.
    // A blank title is allowed here: it becomes "<Category> document".
    checkFiling({ ...filing, title: filing.title.trim() || "untitled", size: bytes.length });

    const read = await readSafely(bytes, upload.type);
    const intake = await withVault(request, (db) => fileAndRead(db, filing, read));

    return Response.json(intake);
  } catch (error) {
    if (error instanceof UploadRefused) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if ((error as { cause?: { code?: string } })?.cause?.code === "42501") {
      return Response.json({ error: "You cannot file a document for that owner." }, { status: 403 });
    }
    throw error;
  }
}
