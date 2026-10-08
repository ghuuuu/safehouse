import { Form, Link, redirect, useNavigation } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/upload";
import { withVault } from "../session.server";
import { ACCEPTED_TYPES, CATEGORIES, MAX_UPLOAD_BYTES } from "../documents";
import { fileDocument, UploadRefused } from "../upload.server";

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
 * that matters is made again on the way in — `records_write` re-checks the
 * owner against the same predicate when the row is inserted, so a hand-posted
 * owner id that never appeared in anybody's dropdown is refused by the
 * database (`0005_write_policies.sql`).
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
  const upload = form.get("file");

  if (!(upload instanceof File)) {
    return { error: "Choose a file." };
  }

  // Read the bytes before the transaction opens: holding a database
  // transaction open across a network read is how a slow upload becomes a
  // database problem.
  const bytes = Buffer.from(await upload.arrayBuffer());

  try {
    const filed = await withVault(request, (db) =>
      fileDocument(db, {
        ownerId: String(form.get("ownerId") ?? ""),
        category: String(form.get("category") ?? "") as never,
        title: String(form.get("title") ?? ""),
        mime: upload.type,
        bytes,
      }),
    );

    return redirect(`/vault?filed=${filed.documentId}`);
  } catch (error) {
    if (error instanceof UploadRefused) {
      return { error: error.message };
    }

    // A permission refusal reads as a database error. Saying which owner was
    // refused would answer a question the asker was not entitled to ask.
    if ((error as { cause?: { code?: string } })?.cause?.code === "42501") {
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
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-6 md:p-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">File a document</h1>
        <p className="mt-1 text-sm text-gray-500">
          It is encrypted before it reaches the disk. Up to{" "}
          {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB, PDF or an image.
        </p>
      </div>

      {canFile ? (
        <Form
          method="post"
          encType="multipart/form-data"
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            Whose is it?
            <select
              name="ownerId"
              required
              // Nothing pre-chosen when there is a choice: a default here is
              // how a passport gets filed under whoever sorts first.
              defaultValue={owners.length === 1 ? owners[0].id : ""}
              className="rounded-lg border border-gray-300 p-2"
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

          <label className="flex flex-col gap-1 text-sm">
            What is it?
            <input
              name="title"
              required
              maxLength={200}
              placeholder="Passport, council tax bill, boiler warranty"
              className="rounded-lg border border-gray-300 p-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Where does it belong?
            <select
              name="category"
              required
              defaultValue=""
              className="rounded-lg border border-gray-300 p-2"
            >
              <option value="" disabled>
                Choose a kind
              </option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            The file
            <input
              type="file"
              name="file"
              required
              accept={ACCEPTED_TYPES.join(",")}
              className="rounded-lg border border-gray-300 p-2"
            />
          </label>

          {actionData?.error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
            >
              {actionData.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={filing}
            className="self-start rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {filing ? "Filing…" : "File it"}
          </button>
        </Form>
      ) : (
        <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600">
          Your account can read the vault but not add to it.
        </p>
      )}

      <Link className="self-start py-2 text-sm text-gray-500 underline" to="/vault">
        Back to the vault
      </Link>
    </main>
  );
}
