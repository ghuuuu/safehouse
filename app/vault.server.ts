/**
 * The vault list, written once.
 *
 * This is a string rather than a query builder call so that the route and the
 * permission tests run the identical statement. A test that reasons about a
 * retyped copy of a query proves something about the copy.
 *
 * It takes no parameters, deliberately. Who the rows belong to is decided by
 * the transaction's user (`app/db.server.ts`) and the policies in
 * `0001_permission_layer.sql` — never by a value spliced in here.
 *
 * What it does not select is as deliberate: `documents.identifier_sealed`
 * holds the passport number (D35). Masked in the interface means absent from the payload
 * (CLAUDE.md), so a surface that genuinely needs it has to ask for it on
 * purpose rather than inherit it from this list.
 *
 * The join to `owners` is a LEFT join, and that is not a defensive habit. A
 * per-record grant (D17) reaches a record without reaching its owner — a third
 * party handed one will by name can see the will and cannot see whose estate
 * it belongs to, which `permissions.test.ts` asserts on purpose. An inner join
 * here would drop that document off their list entirely: a document they are
 * entitled to see, disappearing because a second table declined to describe
 * it. So the owner name is allowed to be null, and the interface has to say
 * so rather than render a blank.
 */
export const VAULT_LIST_SQL = `
  select
    d.id,
    r.category,
    r.title,
    r.is_private as "isPrivate",
    o.display_name as "ownerName",
    -- From owners, not records.owner_id, so it is null exactly when the name
    -- is: a per-record grant does not get to learn who its owner is (D17).
    o.id as "ownerId",
    d.version_no as "versionNo",
    d.is_current as "isCurrent",
    d.expires_on as "expiresOn",
    -- Asked of the database, so the page and the server agree on "today".
    coalesce(d.expires_on < current_date, false) as "expired",
    -- Correlated rather than joined, because a document with two pages would
    -- otherwise appear in this list twice. Both subqueries read through
    -- document_files_read, so a page the viewer may not see is neither
    -- linked nor counted.
    (
      select f.id from document_files f
      where f.document_id = d.id order by f.page_no limit 1
    ) as "fileId",
    (
      select count(*)::int from document_files f where f.document_id = d.id
    ) as "fileCount"
  from documents d
  join records r on r.id = d.record_id
  left join owners o on o.id = r.owner_id
  order by r.category, o.display_name, r.title, d.version_no desc
`;

/**
 * One owner's documents, out of a list the policies have already decided.
 *
 * A narrowing, not a permission: it can only remove rows, and it runs on the
 * server, so nothing it drops was ever sent. That is why it is a filter over
 * the list rather than a parameter in the query above, which stays
 * parameterless so who sees what is never a value spliced into it. An owner the
 * viewer cannot see has no rows here, so asking for one gets the same empty
 * answer as an owner with no documents.
 *
 * ponytail: filters the whole list in memory, which is fine at household scale.
 * Move it into SQL if a vault ever holds thousands of documents.
 */
export function forOwner<T extends { ownerId: string | null }>(
  rows: T[],
  ownerId: string,
): T[] {
  return rows.filter((row) => row.ownerId !== null && row.ownerId === ownerId);
}
