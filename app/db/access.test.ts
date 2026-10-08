/**
 * The access console's data (Step 12, D21, D34).
 *
 * D21's promise is that the console cannot disagree with what a user actually
 * sees, because it reads the same policies the vault does. The strongest form
 * of that test is the one here: the console's matrix, built through the app's
 * own code, against `matrix.txt`, which the policies wrote.
 *
 * And D34's: the denominator — how much of the vault the admin reaches — is an
 * admin's number. Nothing here hands it, or anybody else's reach, to anyone
 * else.
 */

import { readFileSync } from "node:fs";

import { sql as drizzleSql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { SignedInUser } from "../session.server";
import type { RosterEntry, ViewContext } from "../view-as.server";
import { OWNER, RECORD, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

let access: typeof import("../access.server");
let asUser: typeof import("../db.server").asUser;
let roster: RosterEntry[];

beforeAll(async () => {
  await prepareTestDatabase();

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
  access = await import("../access.server");
  const { ROSTER_SQL } = await import("../view-as.server");

  roster = await asUser(USER.priya, async (db) => [
    ...(await db.execute<RosterEntry>(drizzleSql.raw(ROSTER_SQL))),
  ]);
}, 60_000);

afterAll(closeTestDatabase);

const actor = (id: string, role: string): SignedInUser => ({
  id,
  role,
  email: `${role}@example.invalid`,
  name: "Fixture User",
  personOwnerId: null,
});

const PRIYA = actor(USER.priya, "admin");
const MAYA = actor(USER.maya, "individual");

function viewing(subject: string): ViewContext {
  return {
    actor: PRIYA,
    viewedUserId: subject,
    isViewingAs: true,
    viewedUser: roster.find((entry) => entry.id === subject)!,
    roster,
  };
}

class Rollback extends Error {}

/** The app's own transaction, as Priya, thrown away at the end. */
async function rollingBack(work: Parameters<typeof asUser>[1]): Promise<void> {
  await asUser(USER.priya, async (db) => {
    await work(db);
    throw new Rollback();
  }).catch((error) => {
    if (!(error instanceof Rollback)) throw error;
  });
}

async function status(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return null;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    throw thrown;
  }
}

describe("the matrix", () => {
  test("agrees with matrix.txt, which the policies wrote", async () => {
    const matrix = await access.getMatrix(PRIYA, roster);

    const committed = new Map(
      [...readFileSync("app/db/matrix.txt", "utf8").matchAll(/^(\w+)\s+\w+\s+(\d+) of (\d+)$/gm)].map(
        ([, account, reached]) => [USER[account as keyof typeof USER], Number(reached)],
      ),
    );

    expect(committed.size).toBe(Object.keys(USER).length);
    for (const row of matrix.rows) {
      expect([row.user.name, row.total]).toEqual([row.user.name, committed.get(row.user.id)]);
    }
    expect(matrix.reachable).toBe(committed.get(USER.priya));
  });

  test("every cell adds up to its row", async () => {
    const matrix = await access.getMatrix(PRIYA, roster);

    for (const row of matrix.rows) {
      const byOwner = Object.values(row.byOwner).reduce((a, b) => a + b, 0);
      const byCategory = Object.values(row.byCategory).reduce((a, b) => a + b, 0);
      expect([byOwner, byCategory]).toEqual([row.total, row.total]);
    }
  });

  test("Sam's row is the business, in the two kinds he was granted, and Rose's will", async () => {
    const matrix = await access.getMatrix(PRIYA, roster);
    const sam = matrix.rows.find((row) => row.user.id === USER.sam)!;

    expect(Object.keys(sam.byOwner).sort()).toEqual([OWNER.hale, OWNER.rose].sort());
    expect(Object.keys(sam.byCategory).sort()).toEqual(["business", "financial", "legal"]);
  });

  test("is refused to anybody who is not an admin", async () => {
    expect(await status(access.getMatrix(MAYA, roster))).toBe(403);
  });
});

describe("one account's panel", () => {
  test("says how much they reach, out of what the admin reaches", async () => {
    const panel = await access.getPanel(viewing(USER.sam));

    expect([panel.reach, panel.reachable]).toEqual([9, 36]);
    expect(panel.grants.owners).toEqual([OWNER.hale]);
    expect(panel.grants.categories.sort()).toEqual(["business", "financial"]);
    expect(panel.grants.records.map((r) => r.id)).toEqual([RECORD.roseWill]);
    expect(panel.grantable).toEqual(["owner", "category", "record"]);
  });

  test("names whose papers they reach, and which of those were granted", async () => {
    const panel = await access.getPanel(viewing(USER.daniel));
    const granted = panel.reaches.filter((o) => o.granted).map((o) => o.id);

    // Daniel's circle comes from the tree; the business is the one thing he
    // was given by hand.
    expect(granted).toEqual([OWNER.hale]);
    expect(panel.reaches.map((o) => o.id)).toContain(OWNER.maya);
    expect(panel.grantable).toEqual(["owner", "record"]);
  });

  test("an admin and an emergency contact have nothing to grant", async () => {
    // Priya's own id is not viewing-as, so ask about the medic and fake an
    // admin subject from the roster's own row.
    expect((await access.getPanel(viewing(USER.medic))).grantable).toEqual([]);
    expect(access.grantableFor("admin")).toEqual([]);
  });

  test("is refused to anybody who is not an admin", async () => {
    const asMaya = { ...viewing(USER.sam), actor: MAYA };
    expect(await status(access.getPanel(asMaya))).toBe(403);
  });
});

describe("changing grants", () => {
  async function log(db: Parameters<Parameters<typeof asUser>[1]>[0]) {
    return [
      ...(await db.execute<{ action: string; target_id: string | null; target_category: string | null }>(drizzleSql`
        select action, target_id, target_category from activity_events
        where subject_id = ${USER.sam} and action like 'grant.%'
        order by action, target_id, target_category
      `)),
    ];
  }

  test("adds and removes the difference, one log line per change", async () => {
    await rollingBack(async (db) => {
      const result = await access.setGrants(db, USER.sam, "owner", [OWNER.hale, OWNER.rose]);
      expect(result).toEqual({ ok: true, changed: 1 });
      expect(await log(db)).toEqual([
        { action: "grant.added", target_id: OWNER.rose, target_category: null },
      ]);

      expect(await access.setGrants(db, USER.sam, "owner", [])).toEqual({ ok: true, changed: 2 });
      expect(await access.setGrants(db, USER.sam, "category", ["legal"])).toEqual({ ok: true, changed: 3 });

      const [{ n }] = await db.execute<{ n: number }>(
        drizzleSql`select count(*)::int as n from grant_owners where user_id = ${USER.sam}`,
      );
      expect(n).toBe(0);
      expect((await log(db)).map((line) => `${line.action} ${line.target_category ?? line.target_id}`).sort()).toEqual([
        "grant.added legal",
        `grant.added ${OWNER.rose}`,
        "grant.removed business",
        "grant.removed financial",
        `grant.removed ${OWNER.hale}`,
        `grant.removed ${OWNER.rose}`,
      ].sort());
    });
  });

  test("saving what is already there changes and logs nothing", async () => {
    await rollingBack(async (db) => {
      expect(await access.setGrants(db, USER.sam, "record", [RECORD.roseWill])).toEqual({ ok: true, changed: 0 });
      expect(await log(db)).toEqual([]);
    });
  });

  test("refuses what is not an id or a category before asking the database", async () => {
    await rollingBack(async (db) => {
      expect(await access.setGrants(db, USER.sam, "category", ["secret"])).toMatchObject({ ok: false });
      expect(await access.setGrants(db, USER.sam, "owner", ["not-an-id"])).toMatchObject({ ok: false });
      expect(await access.setGrants(db, "not-an-id", "owner", [])).toMatchObject({ ok: false });
    });
  });

  test("a member asking is refused by the database, not by this module", async () => {
    const thrown = await asUser(USER.maya, (db) =>
      access.setGrants(db, USER.maya, "record", [RECORD.ivyCounselling]),
    ).catch((error: { cause?: { code?: string } }) => error.cause?.code);

    expect(thrown).toBe("42501");
    const [row] = await owner()`select count(*)::int as n from grant_records where user_id = ${USER.maya}`;
    expect(row.n).toBe(0);
  });
});
