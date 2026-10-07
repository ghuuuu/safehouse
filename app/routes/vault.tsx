import { Form, Link } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/vault";
import { ACTIONS, record } from "../activity.server";
import { forOwner, VAULT_LIST_SQL } from "../vault.server";
import {
  resolveViewContext,
  withActorVault,
  withViewedVault,
} from "../view-as.server";

export function meta() {
  return [{ title: "Vault — Safehouse" }];
}

type DocumentRow = {
  id: string;
  category: string;
  title: string;
  /** Null when the viewer reached the document without reaching its owner. */
  ownerName: string | null;
  /** Null exactly when `ownerName` is. */
  ownerId: string | null;
  versionNo: number;
  isCurrent: boolean;
  isPrivate: boolean;
  expiresOn: string | null;
  /** The first page, or null when the viewer reaches the document but no file. */
  fileId: string | null;
  fileCount: number;
};

/**
 * How this surface enforces access.
 *
 * The document query below has no permission logic in it. It selects from
 * `documents` joined to `records` and `owners`, and all three carry row-level
 * security, so the joins cannot widen the result — a record the viewer may not
 * see removes its documents from the answer rather than adding an owner name
 * to them. What the viewer is entitled to is decided by the policies in
 * `0001_permission_layer.sql`, in the database, before this page exists.
 *
 * The one thing this loader does decide is *whose* entitlement to use, and it
 * decides that in `resolveViewContext` before either transaction opens. See
 * `app/view-as.server.ts`.
 *
 * `?owner=` (where a tree click lands) narrows the list further, here on the
 * server, using `forOwner`. It removes rows and never adds any. The owner's
 * name for the heading is read through `owners_read`, so an owner the viewer
 * cannot see gets no name and no documents: the same empty page as a stranger.
 *
 * Note what is not selected: `documents.identifier` holds the passport number.
 * It is masked in the interface, so it must not be in the payload that renders
 * the interface (CLAUDE.md). A record view that needs it can ask for it there,
 * deliberately.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const view = await resolveViewContext(request);
  const ownerId = new URL(request.url).searchParams.get("owner");

  const { all, ownerName } = await withViewedVault(view, async (db) => {
    const rows = await db.execute<DocumentRow>(sql.raw(VAULT_LIST_SQL));
    // Compared as text, so a malformed id finds nothing instead of raising a
    // cast error that would tell it apart from a real one.
    const [owner] = ownerId
      ? await db.execute<{ name: string }>(
          sql`select display_name as name from owners where id::text = ${ownerId}`,
        )
      : [];
    return { all: [...rows], ownerName: owner?.name ?? null };
  });

  const documents = ownerId ? forOwner(all, ownerId) : all;

  // The denominator in "14 of 36", counted as the actor rather than as a raw
  // total — an admin who could not see everything must not be told how much
  // everything is.
  if (view.isViewingAs) {
    // Recorded in the actor's own transaction, because the viewed one is
    // read-only (and because the line is about what the admin did, not about
    // what the person whose eyes they borrowed did).
    await withActorVault(view, (db) =>
      record(db, {
        action: ACTIONS.vaultViewedAs,
        subjectType: "user",
        subjectId: view.viewedUserId,
        actingAsUserId: view.viewedUserId,
      }),
    );
  }

  const reachable = view.isViewingAs
    ? await withActorVault(view, async (db) => {
        const [row] = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from documents`,
        );
        return row.n;
      })
    : all.length;

  return {
    documents,
    // The viewed user's whole reach, for "N of M": narrowing to one owner does
    // not change how much of the vault they can see.
    reachedByViewed: all.length,
    owner: ownerId ? { id: ownerId, name: ownerName } : null,
    reachable,
    actor: view.actor,
    isViewingAs: view.isViewingAs,
    viewedUser: view.viewedUser,
    roster: view.roster,
  };
}

function groupByCategory(documents: DocumentRow[]) {
  const groups = new Map<string, DocumentRow[]>();

  for (const document of documents) {
    const group = groups.get(document.category);
    if (group) group.push(document);
    else groups.set(document.category, [document]);
  }

  return [...groups];
}

export default function Vault({ loaderData }: Route.ComponentProps) {
  const {
    documents,
    reachedByViewed,
    owner,
    reachable,
    actor,
    isViewingAs,
    viewedUser,
    roster,
  } = loaderData;

  const canViewAs = actor.role === "admin";
  const groups = groupByCategory(documents);
  // Keeps whose eyes you are using when clearing the owner filter.
  const everything = isViewingAs && viewedUser ? `/vault?as=${viewedUser.id}` : "/vault";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      {isViewingAs && viewedUser ? (
        // The one place in the app that paints its own background, so it is
        // also the one place that has to name its own text colour: the body is
        // dark when the machine is, and white-on-amber is a banner nobody can
        // read. This one says you are not yourself right now, so it has to be
        // the most legible thing on the page.
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p>
            You are seeing the vault as{" "}
            <strong className="font-medium">{viewedUser.name}</strong> (
            {viewedUser.role}
            {viewedUser.disabled ? ", disabled" : null}). They reach{" "}
            <strong className="font-medium">
              {reachedByViewed} of {reachable}
            </strong>{" "}
            documents.
          </p>
          <Link className="underline" to="/vault">
            Back to your own view
          </Link>
        </div>
      ) : null}

      <div>
        <h1 className="text-2xl font-medium tracking-tight">Vault</h1>
        <p className="mt-1 text-sm text-gray-500">
          {documents.length === 1
            ? "One document"
            : `${documents.length} documents`}
          {isViewingAs ? null : `, as ${actor.name}`}.
        </p>
        {owner ? (
          <p className="mt-2 text-sm">
            Showing {owner.name ? <strong className="font-medium">{owner.name}</strong> : "one owner"}
            {"'s documents only. "}
            <Link className="underline" to={everything}>
              Show everything
            </Link>
          </p>
        ) : null}
      </div>

      {canViewAs ? (
        <Form method="get" className="flex flex-wrap items-center gap-2 text-sm">
          {owner ? <input type="hidden" name="owner" value={owner.id} /> : null}
          <label className="text-gray-500" htmlFor="as">
            View as
          </label>
          <select
            className="rounded-lg border border-gray-300 p-2"
            id="as"
            name="as"
            defaultValue={isViewingAs ? viewedUser?.id : ""}
          >
            <option value="">Yourself</option>
            {roster
              .filter((entry) => entry.id !== actor.id)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.role}
                  {entry.disabled ? ", disabled" : ""})
                </option>
              ))}
          </select>
          <button
            className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white"
            type="submit"
          >
            Look
          </button>
        </Form>
      ) : null}

      {groups.length === 0 ? (
        <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600">
          {owner
            ? "Nothing here that you can see."
            : `Nothing here. ${isViewingAs ? "This account" : "You"} cannot see any documents.`}
        </p>
      ) : null}

      {groups.map(([category, rows]) => (
        <section key={category} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
            {category}
          </h2>
          <ul className="rounded-lg border border-gray-200 text-sm">
            {rows.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 p-4 last:border-b-0"
              >
                <span>
                  <Link className="underline" to={`/record/${document.id}`}>
                    {document.title}
                  </Link>
                  <span className="text-gray-500">
                    {" — "}
                    {document.ownerName ?? (
                      // Reachable by a per-record grant, which carries the
                      // document without carrying its owner (D17). Saying so
                      // beats an empty dash that reads like missing data.
                      <em className="not-italic">owner not shown to you</em>
                    )}
                  </span>
                </span>
                <span className="flex items-baseline gap-2 text-xs text-gray-500">
                  {document.fileId ? (
                    <Link
                      className="underline"
                      to={`/file/${document.fileId}`}
                      reloadDocument
                    >
                      open{document.fileCount > 1 ? ` (${document.fileCount} pages)` : ""}
                    </Link>
                  ) : null}
                  {document.isPrivate ? <span>private</span> : null}
                  {document.isCurrent ? null : (
                    <span>superseded (v{document.versionNo})</span>
                  )}
                  {document.expiresOn ? (
                    <span>expires {document.expiresOn}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="flex gap-4 text-sm">
        {isViewingAs ? null : (
          // Hidden while viewing as somebody else, because the transaction that
          // would file it is read-only: offering the link would be offering a
          // button that cannot work.
          <Link className="text-gray-500 underline" to="/upload">
            File a document
          </Link>
        )}
        <Link className="text-gray-500 underline" to="/">
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
