import { Form, Link } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/vault";
import { VAULT_LIST_SQL } from "../vault.server";
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
  versionNo: number;
  isCurrent: boolean;
  isPrivate: boolean;
  expiresOn: string | null;
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
 * Note what is not selected: `documents.identifier` holds the passport number.
 * It is masked in the interface, so it must not be in the payload that renders
 * the interface (CLAUDE.md). A record view that needs it can ask for it there,
 * deliberately.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const view = await resolveViewContext(request);

  const documents = await withViewedVault(view, async (db) => {
    const rows = await db.execute<DocumentRow>(sql.raw(VAULT_LIST_SQL));
    return [...rows];
  });

  // The denominator in "14 of 36", counted as the actor rather than as a raw
  // total — an admin who could not see everything must not be told how much
  // everything is.
  const reachable = view.isViewingAs
    ? await withActorVault(view, async (db) => {
        const [row] = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from documents`,
        );
        return row.n;
      })
    : documents.length;

  return {
    documents,
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
  const { documents, reachable, actor, isViewingAs, viewedUser, roster } =
    loaderData;

  const canViewAs = actor.role === "admin";
  const groups = groupByCategory(documents);

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
              {documents.length} of {reachable}
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
      </div>

      {canViewAs ? (
        <Form method="get" className="flex flex-wrap items-center gap-2 text-sm">
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
          Nothing here. {isViewingAs ? "This account" : "You"} cannot see any
          documents.
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
                  {document.title}
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
                <span className="flex gap-2 text-xs text-gray-500">
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

      <Link className="text-sm text-gray-500 underline" to="/">
        Back to the dashboard
      </Link>
    </main>
  );
}
