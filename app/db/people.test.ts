/**
 * Adding somebody to the household, and who is allowed to.
 *
 * The negative tests are the point of this file. A tree edge is read directly by
 * `family_circle`, so inserting one spouse row hands an account somebody else's
 * whole vault — which makes "who may add a person" an access-control question
 * dressed as a data entry form. Every test here that expects a refusal is
 * guarding that, and `0009_person_writes.sql` is where the rule lives.
 *
 * Every write rolls back. The fixture's exact-count assertions in
 * permissions.test.ts would start failing for unrelated reasons otherwise.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { VaultTransaction } from "../db.server";
import { addPerson, listHousehold } from "../people.server";
import { OWNER, USER } from "./fixture";
import { closeTestDatabase, prepareTestDatabase } from "./test-harness";

let asUser: typeof import("../db.server").asUser;

beforeAll(async () => {
  await prepareTestDatabase();

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
}, 60_000);

afterAll(closeTestDatabase);

/**
 * Runs the work and throws it away, whatever happened.
 *
 * `asUser` commits, and these tests all write. Rolling back by raising at the
 * end of the transaction is the same trick `asUserRollingBack` plays in the
 * harness, done here because `addPerson` takes the Drizzle transaction the
 * routes use rather than the raw postgres one.
 */
class Rollback<T> extends Error {
  constructor(readonly value: T) {
    super("rolling back a people test");
  }
}

async function tryWrite<T>(
  userId: string,
  work: (db: VaultTransaction) => Promise<T>,
): Promise<{ value?: T; code?: string }> {
  try {
    await asUser(userId, async (db) => {
      throw new Rollback(await work(db));
    });
  } catch (error) {
    if (error instanceof Rollback) return { value: error.value as T };

    // Drizzle wraps a driver error in one of its own whose message is the SQL
    // that failed, so the reason is only in the cause. The SQLSTATE rather than
    // the wording, because "refused" and "came back empty" are different
    // answers and only the code says which this was.
    const cause = (error as { cause?: { code?: string } }).cause;
    return { code: cause?.code ?? String(error) };
  }
  throw new Error("unreachable: the rollback sentinel was swallowed");
}

/** Row-level security said no. */
const REFUSED = "42501";

describe("who may add a person", () => {
  test("the admin may", async () => {
    const { value, code } = await tryWrite(USER.priya, (db) =>
      addPerson(db, {
        givenName: "Fixture",
        familyName: "Newcomer",
        bornOn: null,
        link: { relation: "child_of", anchorOwnerId: OWNER.maya, parentType: "biological" },
      }),
    );

    expect(code).toBeUndefined();
    expect(value?.ok).toBe(true);
  });

  test("an ordinary member of the household may not", async () => {
    // Maya can see her own family and file documents for them. Adding a person
    // is a different privilege, and the refusal has to come from the database.
    const { code } = await tryWrite(USER.maya, (db) =>
      addPerson(db, {
        givenName: "Fixture",
        familyName: "Interloper",
        bornOn: null,
        link: null,
      }),
    );

    expect(code).toBe(REFUSED);
  });

  test("a third party may not", async () => {
    const { code } = await tryWrite(USER.sam, (db) =>
      addPerson(db, {
        givenName: "Fixture",
        familyName: "Interloper",
        bornOn: null,
        link: null,
      }),
    );

    expect(code).toBe(REFUSED);
  });

  test("a request that never said who is asking may not", async () => {
    const { code } = await tryWrite("", (db) =>
      addPerson(db, {
        givenName: "Fixture",
        familyName: "Nobody",
        bornOn: null,
        link: null,
      }),
    );

    expect(code).toBe(REFUSED);
  });
});

describe("the sentence the wizard is built on", () => {
  test("a child edge runs from the anchor to the new person", async () => {
    const { value } = await tryWrite(USER.priya, async (db) => {
      const added = await addPerson(db, {
        givenName: "Fixture",
        familyName: "Child",
        bornOn: "2020-04-01",
        link: {
          relation: "child_of",
          anchorOwnerId: OWNER.maya,
          parentType: "biological",
        },
      });

      if (!added.ok) throw new Error(added.problem);

      const rows = await db.execute<{ from: string; to: string; kind: string }>(
        sql`
          select from_owner_id as "from", to_owner_id as "to", kind
          from relationships
          where from_owner_id = ${added.ownerId} or to_owner_id = ${added.ownerId}
        `,
      );
      return [...rows];
    });

    // parent_of runs parent to child (D16). The new person is the child, so the
    // anchor must be at the `from` end — the reverse would make a toddler the
    // parent of her mother, and `family_circle` would believe it.
    expect(value).toEqual([
      { from: OWNER.maya, to: expect.any(String), kind: "parent_of" },
    ]);
  });

  test("a parent edge runs the other way", async () => {
    const { value } = await tryWrite(USER.priya, async (db) => {
      const added = await addPerson(db, {
        givenName: "Fixture",
        familyName: "Parent",
        bornOn: null,
        link: {
          relation: "parent_of",
          anchorOwnerId: OWNER.maya,
          parentType: "biological",
        },
      });

      if (!added.ok) throw new Error(added.problem);

      const rows = await db.execute<{ from: string; to: string }>(sql`
        select from_owner_id as "from", to_owner_id as "to"
        from relationships where from_owner_id = ${added.ownerId}
      `);
      return { ownerId: added.ownerId, edges: [...rows] };
    });

    expect(value?.edges).toEqual([
      { from: value?.ownerId, to: OWNER.maya },
    ]);
  });

  test("a spouse edge is stored once and carries no parent type", async () => {
    const { value } = await tryWrite(USER.priya, async (db) => {
      const added = await addPerson(db, {
        givenName: "Fixture",
        familyName: "Spouse",
        bornOn: null,
        link: { relation: "spouse_of", anchorOwnerId: OWNER.bram },
      });

      if (!added.ok) throw new Error(added.problem);

      const rows = await db.execute<{ kind: string; parentType: string | null }>(
        sql`
          select kind, parent_type as "parentType" from relationships
          where from_owner_id = ${added.ownerId} or to_owner_id = ${added.ownerId}
        `,
      );
      return [...rows];
    });

    expect(value).toEqual([{ kind: "spouse_of", parentType: null }]);
  });

  test("a sibling is given the anchor's parents, because siblings are derived", async () => {
    const { value } = await tryWrite(USER.priya, async (db) => {
      // Ivy's parents in the fixture are Daniel and Maya.
      const added = await addPerson(db, {
        givenName: "Fixture",
        familyName: "Sibling",
        bornOn: null,
        link: { relation: "sibling_of", anchorOwnerId: OWNER.ivy },
      });

      if (!added.ok) throw new Error(added.problem);

      const rows = await db.execute<{ from: string }>(sql`
        select from_owner_id as "from" from relationships
        where to_owner_id = ${added.ownerId} and kind = 'parent_of'
        order by from_owner_id
      `);
      return [...rows].map((row) => row.from);
    });

    // D16: no sibling edge is ever stored, so the only way to make two people
    // siblings is to give them a parent in common.
    expect(value).toEqual([OWNER.maya, OWNER.daniel].sort());
  });

  test("a sibling of somebody with no recorded parent is refused, not guessed", async () => {
    const { value } = await tryWrite(USER.priya, (db) =>
      addPerson(db, {
        givenName: "Fixture",
        familyName: "Orphan",
        bornOn: null,
        // Rose is the top of the fixture's tree and has no parent in it.
        link: { relation: "sibling_of", anchorOwnerId: OWNER.rose },
      }),
    );

    expect(value).toEqual({
      ok: false,
      problem: expect.stringMatching(/parent/i),
    });
  });

  test("the first person in a household attaches to nobody", async () => {
    const { value } = await tryWrite(USER.priya, async (db) => {
      const added = await addPerson(db, {
        givenName: "Fixture",
        familyName: "Root",
        bornOn: null,
        link: null,
      });

      if (!added.ok) throw new Error(added.problem);

      const rows = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from relationships
        where from_owner_id = ${added.ownerId} or to_owner_id = ${added.ownerId}
      `);
      return [...rows][0]?.n;
    });

    expect(value).toBe(0);
  });
});

describe("the roster", () => {
  test("the admin sees everybody, with who can sign in", async () => {
    const roster = await asUser(USER.priya, (db) => listHousehold(db));

    expect(roster.length).toBe(13);

    const maya = roster.find((row) => row.ownerId === OWNER.maya);
    expect(maya?.account).toEqual({
      name: "Maya Adeyemi",
      role: "individual",
      disabled: false,
    });

    // Frank is in the tree and has no login, which is the ordinary case for
    // somebody who has died or is a child.
    expect(roster.find((row) => row.ownerId === OWNER.frank)?.account).toBeNull();
  });

  test("a third party sees only what they were granted, and no accounts", async () => {
    const roster = await asUser(USER.sam, (db) => listHousehold(db));

    expect(roster.map((row) => row.ownerId)).toEqual([OWNER.hale]);
    // `users_read` gives out your own row and the admin's view. Sam's own
    // account is attached to nobody, so no roster row can carry it.
    expect(roster.every((row) => row.account === null)).toBe(true);
  });

  test("a member sees their circle and only their own login", async () => {
    const roster = await asUser(USER.maya, (db) => listHousehold(db));

    const withAccounts = roster.filter((row) => row.account !== null);

    expect(withAccounts.map((row) => row.ownerId)).toEqual([OWNER.maya]);
    expect(roster.length).toBeGreaterThan(1);
  });

  test("an account attached to nobody sees nothing at all", async () => {
    expect(await asUser(USER.stranger, (db) => listHousehold(db))).toEqual([]);
  });
});
