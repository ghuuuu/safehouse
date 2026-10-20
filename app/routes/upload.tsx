import { Form, Link, redirect, useNavigation } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/upload";
import { withVault } from "../session.server";
import { ACCEPTED_TYPES, CATEGORIES, MAX_UPLOAD_BYTES } from "../documents";
import { draftFromUploads, refusedByPolicy } from "../intake-request.server";
import { UploadRefused } from "../upload.server";
import { Masthead, Page } from "../masthead";

export function meta() {
  return [{ title: "File a document — Safehouse" }];
}

type OwnerOption = { id: string; displayName: string; kind: string };

/**
 * How this surface enforces access.
 *
 * The owner list is `select ... from owners`, with no permission logic in it:
 * `owners_read` decides which rows come back, so the dropdown can only ever
 * offer owners this person can already see. That is presentation. The decision
 * that matters is made again on the way in — `intakes_start` re-checks the
 * owner when the draft is made (`0017_intakes.sql`), and `records_write` once
 * more when it is filed (`0005_write_policies.sql`), so a hand-posted owner id
 * that never appeared in anybody's dropdown is refused by the database.
 *
 * Nothing is filed here (D40). The files become a draft, it is read, and the
 * person is sent to check it.
 *
 * Writes go through `withVault`, never `withViewedVault`: an admin looking at
 * the vault through somebody else's eyes is in a read-only transaction and
 * could not file anything even if this route tried.
 */
export async function loader({ request }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    const rows = await db.execute<OwnerOption>(sql`
      select id, display_name as "displayName", kind
      from owners
      where archived_at is null
      order by kind, display_name
    `);

    return { owners: [...rows], canFile: user.role === "admin" || user.role === "individual" };
  });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length === 0) {
    return { error: "Choose a file." };
  }

  // Read the bytes before any transaction opens: holding a database
  // transaction open across a network read is how a slow upload becomes a
  // database problem.
  const uploads = await Promise.all(files.map(async (f) => ({ mime: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));

  try {
    const draft = await draftFromUploads(request, uploads, {
      init: {
        ownerId: String(form.get("ownerId") ?? "") || null,
        category: String(form.get("category") ?? ""),
        title: String(form.get("title") ?? ""),
      },
    });
    return redirect(`/intake/${draft.intakeId}`);
  } catch (error) {
    if (error instanceof UploadRefused) {
      return { error: error.message };
    }

    // Saying which owner was refused would answer a question the asker was
    // not entitled to ask.
    if (refusedByPolicy(error)) {
      return { error: "You cannot file a document for that person." };
    }

    throw error;
  }
}

export default function Upload({ loaderData, actionData }: Route.ComponentProps) {
  const { owners, canFile } = loaderData;
  const navigation = useNavigation();
  const filing = navigation.state === "submitting";

  return (
    <>
      <Masthead title="File a document" />
      <Page narrow>
        <p className="-mb-2 max-w-prose text-base text-gray-700">
          Photos and PDFs become one PDF, every page the size of the real paper. You check the pages and what
          was read from them before it is filed. Encrypted before it reaches the disk; up to{" "}
          <span className="font-mono">{Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}</span> MB a file.
        </p>

        {canFile ? (
          <Form
            method="post"
            encType="multipart/form-data"
            className="sheet flex flex-col gap-5 p-5 md:p-6"
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Whose is it?
              <select
                name="ownerId"
                required
                // Nothing pre-chosen when there is a choice: a default here is
                // how a passport gets filed under whoever sorts first.
                defaultValue={owners.length === 1 ? owners[0].id : ""}
                className="field font-normal"
              >
                {owners.length === 1 ? null : (
                  <option value="" disabled>
                    Choose a person, business or the household
                  </option>
                )}
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.displayName}
                    {owner.kind === "person" ? "" : ` (${owner.kind})`}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              What is it?
              <input
                name="title"
                required
                maxLength={200}
                placeholder="Passport, council tax bill, boiler warranty"
                className="field font-normal"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Where does it belong?
              <select
                name="category"
                required
                defaultValue=""
                className="field font-normal"
              >
                <option value="" disabled>
                  Choose a kind
                </option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category[0].toUpperCase() + category.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              The pages: photos or PDFs, as many as it has
              <input
                type="file"
                name="file"
                multiple
                required
                accept={ACCEPTED_TYPES.join(",")}
                className="border-t border-gray-200 pt-3 font-normal"
              />
            </label>

            {actionData?.error ? (
              <p
                role="alert"
                className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
              >
                {actionData.error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-4 border-t border-gray-200 pt-5">
              <button type="submit" disabled={filing} className="btn btn-primary">
                {filing ? "Reading…" : "Read the pages"}
              </button>
              <Link className="py-2 text-sm text-gray-500 underline hover:text-gray-900" to="/vault">
                Back to the vault
              </Link>
            </div>
          </Form>
        ) : (
          <>
            <p className="sheet p-5 text-sm text-gray-500">
              Your account can read the vault but not add to it.
            </p>
            <Link className="self-start py-2 text-sm text-gray-500 underline hover:text-gray-900" to="/vault">
              Back to the vault
            </Link>
          </>
        )}
      </Page>
    </>
  );
}
