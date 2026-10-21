import { Form, Link } from "react-router";

import type { Route } from "./+types/search";
import { CategoryMark } from "../folder-tab";
import { Masthead, Page } from "../masthead";
import { reference } from "../reference";
import { runSearch } from "../search.server";
import { resolveViewContext } from "../view-as.server";

export function meta() {
  return [{ title: "Search — SafeHouse" }];
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
    <>
      <Masthead
        title="Search"
        serial={
          hits === null ? null : (
            <>
              {hits.length} {hits.length === 1 ? "match" : "matches"}
              {viewing ? ` · searching as ${viewing.name}` : null}
            </>
          )
        }
      >
        <Form method="get" role="search" className="flex w-full gap-2 md:w-[26rem]">
          <label className="sr-only" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            aria-keyshortcuts="/"
            defaultValue={query}
            placeholder="Title, kind, person — or a document's number"
            className="field min-w-0 flex-1 border-transparent"
            autoFocus
          />
          {viewing ? <input type="hidden" name="as" value={viewing.id} /> : null}
          <button className="btn btn-secondary" type="submit">
            Search
          </button>
        </Form>
      </Masthead>

      <Page>
        {viewing ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            Searching as <strong className="font-semibold">{viewing.name}</strong>: only what they can see.{" "}
            <Link className="underline" to={`/search?q=${encodeURIComponent(query)}`}>
              Search as yourself
            </Link>
          </p>
        ) : null}

        <p className="-mt-2 text-xs text-gray-500 max-w-prose">
          Numbers are stored encrypted and found by the whole number or its last four characters, not by a
          part from the middle. A match on a number is recorded in the activity log.
        </p>

        {hits === null ? null : hits.length === 0 ? (
          <p className="sheet p-5 text-sm text-gray-500">Nothing you can see matches that.</p>
        ) : (
          <ul className="sheet text-sm">
            {hits.map((hit) => (
              <li
                key={hit.documentId}
                className="relative grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b border-gray-200 px-4 py-3 last:border-b-0 hover:bg-gray-50 md:px-5"
              >
                <Link className="row-link font-semibold" to={`/record/${hit.documentId}`}>
                  {hit.title}
                </Link>
                <span className="flex flex-wrap items-center justify-end gap-1.5 justify-self-end">
                  {hit.matchedNumber ? <span className="stamp stamp-quiet">Matched its number</span> : null}
                  {hit.isCurrent ? null : <span className="stamp stamp-quiet">An earlier version</span>}
                </span>
                <span className="text-gray-500">
                  {hit.ownerName ? <>{hit.ownerName} · </> : null}
                  <span className="ref">{reference(hit.category, hit.documentId)}</span>
                </span>
                <span className="flex items-center gap-2 justify-self-end text-gray-600">
                  <CategoryMark category={hit.category} />
                  <span className="capitalize">{hit.category}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </>
  );
}
