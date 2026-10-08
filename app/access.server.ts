/**
 * The access console's data (Step 12, D21, D34).
 *
 * Nothing here decides who can see what. Reach is read the way view-as reads
 * it — a read-only transaction in the account's own name, behind `gateViewAs` —
 * so the console and the vault are the same answer asked twice (D21). Grants
 * are written through `withVault` as the admin, and `0012_grant_writes.sql` is
 * what refuses anybody else.
 *
 * The admin check at the top of each reader is the second lock, not the first:
 * `gateViewAs` already refuses a non-admin any account but their own. It is
 * here because these return the admin's own reach as a denominator, and D34
 * says that number goes to an admin or nobody.
 */

import { sql } from "drizzle-orm";

import { ACTIONS, record } from "./activity.server";
import { asUser, type VaultTransaction } from "./db.server";
import { CATEGORIES, type Category } from "./documents";
import { openWindows, type Window } from "./emergency.server";
import type { SignedInUser } from "./session.server";
import {
  gateViewAs,
  UUID,
  withActorVault,
  withViewedVault,
  type RosterEntry,
  type ViewContext,
} from "./view-as.server";

export type GrantKind = "owner" | "category" | "record";

export type OwnerOption = { id: string; name: string; kind: string };

export type RecordOption = {
  id: string;
  title: string;
  ownerName: string;
  category: Category;
  isPrivate: boolean;
};

export type Panel = {
  subject: RosterEntry;
  /** Documents the subject reaches, and documents the admin reaches (D34). */
  reach: number;
  reachable: number;
  /** Whose papers the subject reaches, as the database says, and which by grant. */
  reaches: (OwnerOption & { granted: boolean })[];
  grants: { owners: string[]; categories: Category[]; records: RecordOption[] };
  grantable: GrantKind[];
  options: { owners: OwnerOption[]; records: RecordOption[] };
  /** An emergency contact's open break-glass window, if any (D19). */
  window: Window | null;
};

export type MatrixRow = {
  user: RosterEntry;
  total: number;
  byOwner: Record<string, number>;
  byCategory: Record<string, number>;
};

export type Matrix = { owners: OwnerOption[]; rows: MatrixRow[]; reachable: number };

/**
 * Which grants mean anything for a role, so the panel offers only those.
 * Presentation: the policies do not care, and a category granted to a member
 * simply reaches nothing (0001, `visible_record`).
 */
export function grantableFor(role: string): GrantKind[] {
  if (role === "third_party") return ["owner", "category", "record"];
  if (role === "individual") return ["owner", "record"];
  // An admin already sees everything. An emergency contact's reach is the
  // window and nothing else (D19); a grant would quietly outlive it.
  return [];
}

function requireAdmin(actor: SignedInUser): void {
  if (actor.role !== "admin") {
    throw new Response("Only an administrator can open the access console.", { status: 403 });
  }
}

const OWNERS_SQL = sql`
  select id, display_name as name, kind::text as kind
  from owners
  order by kind, display_name
`;

const RECORDS_SQL = sql`
  select r.id, r.title, o.display_name as "ownerName", r.category, r.is_private as "isPrivate"
  from records r
  join owners o on o.id = r.owner_id
  order by o.display_name, r.title
`;

const DOCUMENT_COUNT_SQL = sql`select count(*)::int as n from documents`;

async function count(db: VaultTransaction): Promise<number> {
  const [row] = await db.execute<{ n: number }>(DOCUMENT_COUNT_SQL);
  return row.n;
}

export async function getPanel(view: ViewContext): Promise<Panel> {
  requireAdmin(view.actor);
  const subject = view.viewedUser;
  if (!subject) throw new Response("Pick an account.", { status: 400 });

  const theirs = await withViewedVault(gateViewAs(view.actor, subject.id), async (db) => ({
    reach: await count(db),
    reaches: [...(await db.execute<OwnerOption>(OWNERS_SQL))],
  }));

  const ours = await withActorVault(view, async (db) => {
    const owners = [...(await db.execute<{ id: string }>(sql`
      select owner_id as id from grant_owners where user_id = ${subject.id}
    `))].map((row) => row.id);
    const categories = [...(await db.execute<{ category: Category }>(sql`
      select category from grant_categories where user_id = ${subject.id} order by category
    `))].map((row) => row.category);
    const allRecords = [...(await db.execute<RecordOption>(RECORDS_SQL))];
    const recordIds = new Set(
      [...(await db.execute<{ id: string }>(sql`
        select record_id as id from grant_records where user_id = ${subject.id}
      `))].map((row) => row.id),
    );

    return {
      window: (await openWindows(db)).find((w) => w.userId === subject.id) ?? null,
      reachable: await count(db),
      grants: { owners, categories, records: allRecords.filter((r) => recordIds.has(r.id)) },
      options: { owners: [...(await db.execute<OwnerOption>(OWNERS_SQL))], records: allRecords },
    };
  });

  const granted = new Set(ours.grants.owners);

  return {
    subject,
    reach: theirs.reach,
    reachable: ours.reachable,
    reaches: theirs.reaches.map((o) => ({ ...o, granted: granted.has(o.id) })),
    grants: ours.grants,
    grantable: grantableFor(subject.role),
    options: ours.options,
    window: ours.window,
  };
}

/**
 * Every account against every owner and category, read as each account in
 * turn.
 *
 * ponytail: one read-only transaction per account, so N accounts is N round
 * trips. A household has a dozen; if a deployment ever has hundreds, read the
 * whole grid in one `perm` function instead.
 */
export async function getMatrix(actor: SignedInUser, roster: RosterEntry[]): Promise<Matrix> {
  requireAdmin(actor);

  const { owners, reachable } = await asUser(actor.id, async (db) => ({
    owners: [...(await db.execute<OwnerOption>(OWNERS_SQL))],
    reachable: await count(db),
  }));

  const rows: MatrixRow[] = [];
  for (const user of roster) {
    const cells = await withViewedVault(gateViewAs(actor, user.id), async (db) => [
      ...(await db.execute<{ ownerId: string; category: string; n: number }>(sql`
        select r.owner_id as "ownerId", r.category, count(*)::int as n
        from documents d
        join records r on r.id = d.record_id
        group by 1, 2
      `)),
    ]);

    const row: MatrixRow = { user, total: 0, byOwner: {}, byCategory: {} };
    for (const cell of cells) {
      row.total += cell.n;
      row.byOwner[cell.ownerId] = (row.byOwner[cell.ownerId] ?? 0) + cell.n;
      row.byCategory[cell.category] = (row.byCategory[cell.category] ?? 0) + cell.n;
    }
    rows.push(row);
  }

  return { owners, rows, reachable };
}

const GRANT_TABLES = {
  owner: { table: sql.raw("grant_owners"), column: sql.raw("owner_id"), type: sql.raw("uuid") },
  category: { table: sql.raw("grant_categories"), column: sql.raw("category"), type: sql.raw("category") },
  record: { table: sql.raw("grant_records"), column: sql.raw("record_id"), type: sql.raw("uuid") },
} as const;

export type GrantResult = { ok: true; changed: number } | { ok: false; problem: string };

/**
 * Make one of an account's grant lists exactly `desired`, logging each
 * difference in the same transaction.
 *
 * Refuses malformed input here only so the admin gets a sentence rather than a
 * cast error. Whether the caller may do this at all is the database's call.
 */
export async function setGrants(
  db: VaultTransaction,
  userId: string,
  kind: GrantKind,
  desired: string[],
): Promise<GrantResult> {
  const valid = (value: string) =>
    kind === "category" ? (CATEGORIES as readonly string[]).includes(value) : UUID.test(value);

  if (!UUID.test(userId)) return { ok: false, problem: "Pick an account." };
  if (!desired.every(valid)) return { ok: false, problem: "That is not something that can be granted." };

  const { table, column, type } = GRANT_TABLES[kind];
  const want = new Set(desired.map((value) => value.toLowerCase()));
  const current = new Set(
    [...(await db.execute<{ value: string }>(sql`
      select ${column}::text as value from ${table} where user_id = ${userId}
    `))].map((row) => row.value),
  );

  const target = (value: string) =>
    kind === "category" ? { targetCategory: value } : { targetId: value };
  let changed = 0;

  for (const value of want) {
    if (current.has(value)) continue;
    await db.execute(sql`insert into ${table} (user_id, ${column}) values (${userId}, ${value}::${type})`);
    await record(db, { action: ACTIONS.grantAdded, subjectType: "user", subjectId: userId, ...target(value) });
    changed++;
  }

  for (const value of current) {
    if (want.has(value)) continue;
    // Zero rows is what a refused delete looks like under row-level security,
    // so only a row that actually went is logged.
    const gone = await db.execute(sql`
      delete from ${table} where user_id = ${userId} and ${column} = ${value}::${type} returning 1
    `);
    if (gone.length === 0) continue;
    await record(db, { action: ACTIONS.grantRemoved, subjectType: "user", subjectId: userId, ...target(value) });
    changed++;
  }

  return { ok: true, changed };
}
