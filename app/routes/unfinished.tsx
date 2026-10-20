import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/unfinished";
import { convertDocument, convertible, listIntakes, UploadRefused } from "../intake.server";
import { refusedByPolicy } from "../intake-request.server";
import { Masthead, Page } from "../masthead";
import { withVault } from "../session.server";
import { When } from "../when";

export function meta() {
  return [{ title: "Unfinished — Safehouse" }];
}

/**
 * Everything not yet a finished PDF in the vault (D39, D40): drafts waiting
 * to be checked and filed, and papers filed as images before D39, waiting to
 * be converted.
 *
 * How this surface enforces access. Drafts are listed through
 * `intakes_reach`: one's own, or every one for an admin. The images to
 * convert come from `documents` under the read policies, so only what this
 * person already sees, and are offered only to somebody who may file;
 * converting opens a draft through `intakes_start`, which re-checks the owner
 * and record, and its pages are read through `document_files_read`.
 */
export async function loader({ request }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    const mayFile = user.role === "admin" || user.role === "individual";
    return {
      me: user.id,
      admin: user.role === "admin",
      drafts: await listIntakes(db),
      images: mayFile ? await convertible(db) : [],
    };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  try {
    const id = await withVault(request, (db, user) => convertDocument(db, user.id, String(form.get("documentId") ?? "")));
    return redirect(`/intake/${id}`);
  } catch (error) {
    if (error instanceof UploadRefused) return { error: error.message };
    if (refusedByPolicy(error)) return { error: "You cannot file a new version of that one." };
    throw error;
  }
}

export default function Unfinished({ loaderData, actionData }: Route.ComponentProps) {
  const { me, admin, drafts, images } = loaderData;

  return (
    <>
      <Masthead
        title="Unfinished"
        serial={`${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} · ${images.length} to convert`}
      />
      <Page narrow>
        <p className="-mb-2 max-w-prose text-base text-gray-700">
          Nothing here is in the vault yet. A draft becomes a document when somebody checks its pages and details
          and files it as a PDF.{admin ? " As an administrator you see everybody's drafts." : ""}
        </p>

        {actionData?.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {actionData.error}
          </p>
        ) : null}

        <section aria-labelledby="drafts" className="sheet">
          <h2 id="drafts" className="border-b border-gray-900 px-4 py-3 text-lg font-semibold md:px-5">Drafts</h2>
          {drafts.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-500 md:px-5">
              None. <Link className="underline hover:text-gray-900" to="/upload">File a document</Link> starts one.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {drafts.map((draft) => (
                <li key={draft.id} className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-gray-50 md:px-5">
                  <Link className="row-link font-medium" to={`/intake/${draft.id}`}>
                    {draft.title || "Untitled draft"}
                  </Link>
                  <span className="text-sm text-gray-500">
                    {draft.ownerName ?? "Nobody chosen yet"} · <span className="font-mono">{draft.pages}</span>{" "}
                    {draft.pages === 1 ? "page" : "pages"} · <When at={draft.updatedAt} />
                    {draft.createdBy === me ? null : <span className="stamp stamp-quiet ml-2">Somebody else&apos;s</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {images.length > 0 ? (
          <section aria-labelledby="images" className="sheet">
            <h2 id="images" className="border-b border-gray-900 px-4 py-3 text-lg font-semibold md:px-5">Filed as images</h2>
            <p className="px-4 pt-3 text-sm text-gray-500 md:px-5">
              Filed before every paper became a PDF. Converting opens a draft from it; filing that draft adds the PDF
              as the next version, and the image stays in the record&apos;s history.
            </p>
            <ul className="divide-y divide-gray-200">
              {images.map((doc) => (
                <li key={doc.documentId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5">
                  <span>
                    <Link className="font-medium underline-offset-2 hover:underline" to={`/record/${doc.documentId}`}>{doc.title}</Link>
                    <span className="block text-sm text-gray-500">
                      {doc.ownerName ?? "Shared with you"} · <span className="font-mono">{doc.pages}</span> {doc.pages === 1 ? "page" : "pages"}
                    </span>
                  </span>
                  <Form method="post">
                    <input type="hidden" name="documentId" value={doc.documentId} />
                    <button type="submit" className="btn btn-secondary btn-sm">Convert to PDF</button>
                  </Form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </Page>
    </>
  );
}
