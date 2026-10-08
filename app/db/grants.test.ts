/**
 * Who may change who sees what (Step 12, D21).
 *
 * Written before `0012_grant_writes.sql`. Until it lands every write here fails
 * with a privilege error, which is the answer a database with no grant gives.
 *
 * A grant is the most direct access-control change in the product: one row in
 * `grant_records` is the only route into a private record (D17). So the
 * question is narrower than for any other write — not "may you see this
 * owner", but "are you the administrator" — and the tests ask it of every kind
 * of account there is.
 *
 * Deleting is where row-level security is quietest. A delete the policy does
 * not allow is not an error, it is zero rows, so the refusals below check that
 * the row is still there rather than that nothing threw.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { DOCUMENT, OWNER, RECORD, USER } from "./fixture";
import {
  asUserRollingBack,
  closeTestDatabase,
  owner,
  prepareTestDatabase,
  refusal,
} from "./test-harness";

beforeAll(async () => {
  await prepareTestDatabase();
}, 60_000);

afterAll(async () => {
  await closeTestDatabase();
});

type Sql = Parameters<Parameters<typeof asUserRollingBack>[1]>[0];

/** One of each kind, all to Nina, none of which she holds today. */
const ADD = [
  ["grant_owners", (sql: Sql) => sql`insert into grant_owners (user_id, owner_id) values (${USER.nina}, ${OWNER.ivy})`],
  ["grant_categories", (sql: Sql) => sql`insert into grant_categories (user_id, category) values (${USER.nina}, 'medical')`],
  ["grant_records", (sql: Sql) => sql`insert into grant_records (user_id, record_id) values (${USER.nina}, ${RECORD.roseWill})`],
] as const;

/** One of each kind the fixture already holds. */
const REMOVE = [
  ["grant_owners", (sql: Sql) => sql`delete from grant_owners where user_id = ${USER.sam} and owner_id = ${OWNER.hale} returning 1`],
  ["grant_categories", (sql: Sql) => sql`delete from grant_categories where user_id = ${USER.sam} and category = 'financial' returning 1`],
  ["grant_records", (sql: Sql) => sql`delete from grant_records where user_id = ${USER.sam} and record_id = ${RECORD.roseWill} returning 1`],
] as const;

/** Reads as somebody else, inside the same transaction. */
async function reachOf(sql: Sql, userId: string): Promise<Set<string>> {
  await sql`select set_config('safehouse.user_id', ${userId}, true)`;
  const rows = await sql`select id from documents`;
  return new Set(rows.map((row) => row.id as string));
}

async function grantCount(): Promise<number> {
  const [row] = await owner()`
    select (select count(*) from grant_owners)
         + (select count(*) from grant_categories)
         + (select count(*) from grant_records) as n
  `;
  return Number(row.n);
}

describe("the administrator", () => {
  test.each(ADD)("may add to %s", async (_table, add) => {
    const error = await asUserRollingBack(USER.priya, (sql) => refusal(() => add(sql)));
    expect(error).toBeNull();
  });

  test.each(REMOVE)("may remove from %s", async (_table, remove) => {
    const removed = await asUserRollingBack(USER.priya, async (sql) => (await remove(sql)).length);
    expect(removed).toBe(1);
  });

  test("a per-record grant is what opens a private record, and removing it closes it", async () => {
    const [ninaBefore, ninaAfter, samAfter] = await asUserRollingBack(USER.priya, async (sql) => {
      const before = await reachOf(sql, USER.nina);

      await sql`select set_config('safehouse.user_id', ${USER.priya}, true)`;
      await sql`insert into grant_records (user_id, record_id) values (${USER.nina}, ${RECORD.roseWill})`;
      await sql`delete from grant_records where user_id = ${USER.sam} and record_id = ${RECORD.roseWill}`;

      return [before, await reachOf(sql, USER.nina), await reachOf(sql, USER.sam)];
    });

    // Rose and Legal are both granted to Nina already; the will is private, so
    // the two lists alone never reach it (D17, D18).
    expect(ninaBefore.has(DOCUMENT.roseWill)).toBe(false);
    expect(ninaAfter.has(DOCUMENT.roseWill)).toBe(true);
    expect(samAfter.has(DOCUMENT.roseWill)).toBe(false);
  });

  test("widening one list of a third party's two does not widen the other", async () => {
    const [before, after] = await asUserRollingBack(USER.priya, async (sql) => {
      const before = await reachOf(sql, USER.sam);

      await sql`select set_config('safehouse.user_id', ${USER.priya}, true)`;
      await sql`insert into grant_owners (user_id, owner_id) values (${USER.sam}, ${OWNER.rose})`;

      return [before, await reachOf(sql, USER.sam)];
    });

    // Rose has no business or financial papers, so Sam's two categories give
    // him nothing of hers. The owner list grew and his reach did not.
    expect(after).toEqual(before);
  });
});

describe("nobody else", () => {
  const OTHERS = [
    ["an individual", USER.maya],
    ["a third party", USER.sam],
    ["an emergency contact with an open window", USER.medic],
    ["an account attached to nobody", USER.stranger],
    ["a transaction that never said who it was", null],
  ] as const;

  const cases = OTHERS.flatMap(([who, userId]) =>
    ADD.map(([table, add]) => [who, table, userId, add] as const),
  );

  test.each(cases)("%s may not add to %s", async (_who, _table, userId, add) => {
    const error = await asUserRollingBack(userId, (sql) => refusal(() => add(sql)));
    expect(error?.code).toBe("42501");
  });

  const removals = OTHERS.flatMap(([who, userId]) =>
    REMOVE.map(([table, remove]) => [who, table, userId, remove] as const),
  );

  test.each(removals)("%s may not remove from %s", async (_who, _table, userId, remove) => {
    const removed = await asUserRollingBack(userId, async (sql) => (await remove(sql)).length);
    expect(removed).toBe(0);
  });

  test("a third party cannot widen their own grant", async () => {
    const error = await asUserRollingBack(USER.sam, (sql) =>
      refusal(() => sql`insert into grant_categories (user_id, category) values (${USER.sam}, 'medical')`),
    );
    expect(error?.code).toBe("42501");
  });

  test("a disabled administrator may neither add nor remove", async () => {
    const before = await grantCount();
    await owner()`update users set disabled_at = now() where id = ${USER.priya}`;

    try {
      const added = await asUserRollingBack(USER.priya, (sql) => refusal(() => ADD[2][1](sql)));
      const removed = await asUserRollingBack(USER.priya, async (sql) => (await REMOVE[2][1](sql)).length);

      expect(added?.code).toBe("42501");
      expect(removed).toBe(0);
    } finally {
      await owner()`update users set disabled_at = null where id = ${USER.priya}`;
    }

    expect(await grantCount()).toBe(before);
  });

  test("an administrator looking through somebody else's eyes cannot grant anything", async () => {
    // withViewedVault's transaction. Read-only is Postgres's refusal, not ours.
    const error = await asUserRollingBack(USER.priya, async (sql) => {
      await sql`set transaction read only`;
      return refusal(() => ADD[0][1](sql));
    });
    expect(error?.code).toBe("25006");
  });

  test("nothing else about an account became writable", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`update grant_owners set owner_id = ${OWNER.rose} where user_id = ${USER.sam}`),
    );
    expect(error?.code).toBe("42501");
  });
});

describe("what the log can say about a grant", () => {
  const line = (sql: Sql, targetId: string | null, targetCategory: string | null) => sql`
    insert into activity_events (actor_user_id, action, subject_type, subject_id, target_id, target_category)
    values (${USER.priya}, 'grant.added', 'user', ${USER.nina}, ${targetId}, ${targetCategory})
  `;

  // One transaction each: after the first refusal Postgres aborts the
  // transaction, and everything after it fails for that reason instead.
  const attempt = (targetId: string | null, targetCategory: string | null) =>
    asUserRollingBack(USER.priya, (sql) => refusal(() => line(sql, targetId, targetCategory)));

  test("which owner, record or category, by id or by name of the category", async () => {
    expect(await attempt(OWNER.ivy, null)).toBeNull();
    expect(await attempt(null, "medical")).toBeNull();
  });

  test("and never anything typed in", async () => {
    // Typed columns, so the log cannot be the place a passport number ends up
    // (CLAUDE.md): not a uuid, not a category, not stored.
    expect((await attempt("X1234567", null))?.code).toBe("22P02");
    expect((await attempt(null, "Rose's will"))?.code).toBe("22P02");
  });
});
