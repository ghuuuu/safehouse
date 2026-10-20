import { Form, Link } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/vault";
import { ACTIONS, record } from "../activity.server";
import { FolderTab } from "../folder-tab";
import { Masthead, Page } from "../masthead";
import { reference } from "../reference";
import { roleLabel } from "../roles";
import { longDate } from "../when";
import { forOwner, latestVersions, VAULT_LIST_SQL } from "../vault.server";
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
  recordId: string;
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
  expired: boolean;
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
 * `latestVersions` folds each record's versions into one row, on the server,
 * so older versions are counted but never sent: it drops rows the policies
 * returned and counts only those.
 *
 * `?owner=` (where a tree click lands) narrows the list further, here on the
 * server, using `forOwner`. It removes rows and never adds any. The owner's
 * name for the heading is read through `owners_read`, so an owner the viewer
 * cannot see gets no name and no documents: the same empty page as a stranger.
 *
 * Note what is not selected: `identifier_sealed` holds the passport number.
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
    return { all: latestVersions([...rows]), ownerName: owner?.name ?? null };
  });

  const documents = ownerId ? forOwner(all, ownerId) : all;

  // The denominator in "14 of 36", counted in records like the list, and as
  // the actor rather than as a raw total — an admin who could not see
  // everything must not be told how much everything is.
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
          sql`select count(distinct record_id)::int as n from documents`,
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

function groupByCategory<T extends DocumentRow>(documents: T[]) {
  const groups = new Map<string, T[]>();

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
  const older = documents.reduce((n, d) => n + d.olderVersions, 0);
  // Keeps whose eyes you are using when clearing the owner filter.
  const everything = isViewingAs && viewedUser ? `/vault?as=${viewedUser.id}` : "/vault";

  return (
    <>
      <Masthead
        title="Vault"
        serial={
          <>
            {documents.length === 1 ? "One document" : `${documents.length} documents`}
            {older > 0 ? `, with ${older} older ${older === 1 ? "version" : "versions"} behind them` : null}
            {isViewingAs ? null : `, as ${actor.name}`}
            {isViewingAs && viewedUser ? ` · viewing as ${viewedUser.name}` : null}
          </>
        }
      >
        {isViewingAs ? null : (
          // Hidden while viewing as somebody else, because the transaction that
          // would file it is read-only: offering the link would be offering a
          // button that cannot work.
          <Link className="btn btn-serial" to="/upload">
            File a document
          </Link>
        )}
      </Masthead>

      <Page>
      {isViewingAs && viewedUser ? (
        // The one place in the app that paints its own background, so it is
        // also the one place that has to name its own text colour: the body is
        // dark when the machine is, and white-on-amber is a banner nobody can
        // read. This one says you are not yourself right now, so it has to be
        // the most legible thing on the page.
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p>
            You are seeing the vault as{" "}
            <strong className="font-medium">{viewedUser.name}</strong> (
            {roleLabel(viewedUser.role)}
            {viewedUser.disabled ? ", disabled" : null}). They reach{" "}
            <strong className="font-medium">
              {reachedByViewed} of the {reachable}
            </strong>{" "}
            documents you can see.
          </p>
          <Link className="underline" to="/vault">
            Back to your own view
          </Link>
        </div>
      ) : null}

      {owner ? (
        <p className="text-sm">
          Showing {owner.name ? <strong className="font-semibold">{owner.name}</strong> : "one owner"}
          {"'s documents only. "}
          <Link className="underline" to={everything}>
            Show everything
          </Link>
        </p>
      ) : null}

      {canViewAs ? (
        // Folded away: it is for checking access, not for finding a paper,
        // and on a phone it would otherwise fill the first screen.
        <details open={isViewingAs} className="text-sm">
          <summary className="cursor-pointer py-1 text-gray-600 underline">View as somebody else</summary>
        <Form method="get" className="mt-2 flex flex-wrap items-center gap-2">
          {owner ? <input type="hidden" name="owner" value={owner.id} /> : null}
          <label className="text-gray-500" htmlFor="as">
            View as
          </label>
          <select
            className="field w-auto max-w-full"
            id="as"
            name="as"
            defaultValue={isViewingAs ? viewedUser?.id : ""}
          >
            <option value="">Yourself</option>
            {roster
              .filter((entry) => entry.id !== actor.id)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({roleLabel(entry.role)}
                  {entry.disabled ? ", disabled" : ""})
                </option>
              ))}
          </select>
          <button className="btn btn-primary" type="submit">
            Look
          </button>
        </Form>
        </details>
      ) : null}

      {groups.length === 0 ? (
        <p className="sheet p-5 text-sm text-gray-500">
          {owner
            ? "Nothing here that you can see."
            : `Nothing here. ${isViewingAs ? "This account" : "You"} cannot see any documents.`}
        </p>
      ) : null}

      {groups.map(([category, rows]) => (
        // The id is where the dashboard's category overview lands.
        <section key={category} id={category} className="flex scroll-mt-4 flex-col">
          <FolderTab category={category}>
            {category}
            <span className="ml-auto font-mono text-xs font-normal normal-case text-gray-500">{rows.length}</span>
          </FolderTab>
          <ul className="sheet mt-2 text-sm">
            {rows.map((document) => (
              <li
                key={document.id}
                className="relative grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b border-gray-200 px-4 py-3 last:border-b-0 hover:bg-gray-50 md:px-5"
              >
                <Link className="row-link font-semibold" to={`/record/${document.id}`}>
                  {document.title}
                </Link>
                <span className="flex flex-wrap items-center justify-end gap-1.5 justify-self-end">
                  {document.expiresOn && document.expired ? <span className="stamp stamp-warn">Expired</span> : null}
                  {document.isPrivate ? <span className="stamp stamp-quiet">Private</span> : null}
                  {document.isCurrent ? null : <span className="stamp stamp-quiet">An older version</span>}
                </span>
                <span className="text-gray-500">
                  {document.ownerName ?? (
                    // Reachable by a per-record grant, which carries the
                    // document without carrying its owner (D17). Saying so
                    // beats an empty dash that reads like missing data.
                    <em className="not-italic">owner not shown to you</em>
                  )}
                  {" · "}
                  <span className="ref">{reference(document.category, document.id)}</span>
                </span>
                <span className="flex flex-wrap items-baseline justify-end gap-x-3 justify-self-end text-xs text-gray-600">
                  {document.expiresOn ? (
                    document.expired ? (
                      <span>expired <span className="font-mono">{longDate(document.expiresOn)}</span></span>
                    ) : (
                      <span>expires <span className="font-mono">{longDate(document.expiresOn)}</span></span>
                    )
                  ) : null}
                  {document.olderVersions > 0 ? (
                    <span>
                      <span className="font-mono">{document.olderVersions}</span> older {document.olderVersions === 1 ? "version" : "versions"}
                    </span>
                  ) : null}
                  {document.fileId ? (
                    <Link
                      className="relative z-10 -my-2 px-1 py-2 underline"
                      to={`/file/${document.fileId}`}
                      reloadDocument
                    >
                      open{document.fileCount > 1 ? ` (${document.fileCount} pages)` : ""}
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      </Page>
    </>
  );
}
