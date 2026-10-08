import { Form, Link } from "react-router";

import type { Route } from "./+types/search";
import { CategoryMark } from "../folder-tab";
import { runSearch } from "../search.server";
import { resolveViewContext } from "../view-as.server";

export function meta() {
  return [{ title: "Search — Safehouse" }];
}

/**
 * How this surface enforces access.
 *
 * `runSearch` reads through the policies in the searcher's own transaction, or
 * the viewed user's for an admin using view-as (read-only either way). Nothing
 * here filters, and no hit carries a number: a match by number says only that
 * it matched, and is logged before this loader returns (D35).
 */
export async function loader({ request }: Route.LoaderArgs) {
  const view = await resolveViewContext(request);
  const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 200);

  return {
    query,
    hits: query.trim() ? await runSearch(view, query) : null,
    viewing: view.isViewingAs && view.viewedUser ? view.viewedUser : null,
  };
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, hits, viewing } = loaderData;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-medium tracking-tight">Search</h1>

      {viewing ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Searching as <strong className="font-medium">{viewing.name}</strong>: only what they can see.{" "}
          <Link className="underline" to={`/search?q=${encodeURIComponent(query)}`}>
            Search as yourself
          </Link>
        </p>
      ) : null}

      <Form method="get" role="search" className="flex gap-2">
        <label className="sr-only" htmlFor="q">
          Search
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Title, kind, person — or a document's number"
          className="flex-1 rounded border border-gray-300 p-2"
          autoFocus
        />
        {viewing ? <input type="hidden" name="as" value={viewing.id} /> : null}
        <button className="rounded border border-gray-300 px-4" type="submit">
          Search
        </button>
      </Form>

      <p className="text-xs text-gray-500">
        Numbers are stored encrypted and found by the whole number or its last four characters, not by a
        part from the middle. A match on a number is recorded in the activity log.
      </p>

      {hits === null ? null : hits.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing you can see matches that.</p>
      ) : (
        <ul className="rounded-lg border border-gray-200 text-sm">
          {hits.map((hit) => (
            <li
              key={hit.documentId}
              className="flex items-baseline justify-between gap-4 border-b border-gray-100 p-4 last:border-b-0"
            >
              <span>
                <Link className="underline decoration-gray-300" to={`/record/${hit.documentId}`}>
                  {hit.title}
                </Link>
                {hit.ownerName ? <span className="text-gray-500"> — {hit.ownerName}</span> : null}
                {hit.isCurrent ? null : <span className="text-gray-500"> (an earlier version)</span>}
              </span>
              <span className="flex items-center gap-2 text-gray-500">
                {hit.matchedNumber ? "matched its number · " : ""}
                <CategoryMark category={hit.category} />
                {hit.category}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
