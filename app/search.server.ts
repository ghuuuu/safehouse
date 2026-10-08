/**
 * Search: words against titles, kinds and names; a number against its
 * fingerprints (Step 13, D35).
 *
 * How it enforces access: the query reads `documents`, `records`, `owners`
 * and `subcategories` with no permission logic in it, inside `withViewedVault`,
 * so every row is the policies' decision. An owner the searcher cannot see is
 * a null name, which matches no word. A document the searcher cannot see is no
 * row, which matches no number.
 *
 * The number is never read. The query is fingerprinted with the same key the
 * stored value was, and the database compares fingerprints. A match still
 * tells the searcher something they typed is on a document — for a last-four
 * search, four characters of a masked value — so matches are logged, in the
 * actor's own transaction, before anything is returned (D14's obligation,
 * which D35 keeps).
 */

import { sql, type SQL } from "drizzle-orm";

import { ACTIONS, record } from "./activity.server";
import { queryFingerprints } from "./field-crypto.server";
import type { SignedInUser } from "./session.server";
import { withActorVault, withViewedVault } from "./view-as.server";

export type SearchHit = {
  documentId: string;
  title: string;
  category: string;
  /** Null when the searcher reached the document without reaching its owner. */
  ownerName: string | null;
  isCurrent: boolean;
  /** Found by its number, rather than by a word. Never the number. */
  matchedNumber: boolean;
};

type SearchContext = { actor: SignedInUser; viewedUserId: string; isViewingAs: boolean };

const LIMIT = 50;

/** `%` and `_` are characters somebody typed, not patterns. */
function literal(word: string): string {
  return `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function runSearch(view: SearchContext, query: string): Promise<SearchHit[]> {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length === 0) return [];

  const number = queryFingerprints(query);
  const byNumber: SQL = number
    ? sql`(d.identifier_fp = ${number.full}${number.last4 ? sql` or d.identifier_last4_fp = ${number.last4}` : sql``})`
    : sql`false`;

  // Every word somewhere in the title, the kind, the subcategory or the
  // owner's name. Current versions only: an old passport is found through its
  // record, unless it is its own number being asked for.
  const byWords = sql.join(
    words.map((word) => {
      const pattern = literal(word);
      return sql`(r.title ilike ${pattern} or r.category::text ilike ${pattern}
        or s.label ilike ${pattern} or o.display_name ilike ${pattern})`;
    }),
    sql` and `,
  );

  const hits = await withViewedVault(view, async (db) => [
    ...(await db.execute<SearchHit>(sql`
      select
        d.id as "documentId", r.title, r.category::text as category,
        o.display_name as "ownerName", d.is_current as "isCurrent",
        ${byNumber} as "matchedNumber"
      from documents d
      join records r on r.id = d.record_id
      left join owners o on o.id = r.owner_id
      left join subcategories s on s.id = r.subcategory_id
      where ${byNumber} or (d.is_current and ${byWords})
      order by "matchedNumber" desc, r.title, o.display_name, d.version_no desc
      limit ${LIMIT}
    `)),
  ]);

  const matched = hits.filter((hit) => hit.matchedNumber);
  if (matched.length > 0) {
    await withActorVault(view, async (db) => {
      for (const hit of matched) {
        await record(db, {
          action: ACTIONS.fieldMatched,
          subjectType: "document",
          subjectId: hit.documentId,
          actingAsUserId: view.isViewingAs ? view.viewedUserId : null,
        });
      }
    });
  }

  return hits;
}
