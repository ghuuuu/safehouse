/**
 * The dashboard's data (Step 14).
 *
 * A new surface that counts documents, so CLAUDE.md asks how it enforces
 * access: `getDashboard` has no permission logic and reads through the
 * signed-in user's transaction. These tests hold it to that. The admin's counts
 * are checked against the owner connection, which sees everything, and every
 * other account is checked for what it must not be told.
 *
 * The mode switch (PRODUCT.md §Owners) splits by owner kind: Businesses is
 * business owners, Individuals is everything else, including a record whose
 * owner the viewer cannot see. That last case is Sam's per-record grant on
 * Rose's will: it has to land somewhere, and it cannot say whose it is.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { DOCUMENT, OWNER, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

let asUser: typeof import("../db.server").asUser;
let getDashboard: typeof import("../dashboard.server").getDashboard;

beforeAll(async () => {
  await prepareTestDatabase();

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
  ({ getDashboard } = await import("../dashboard.server"));
}, 60_000);

afterAll(closeTestDatabase);

type Mode = "individuals" | "businesses";
const NAMES = new Map(Object.entries(DOCUMENT).map(([name, id]) => [id, name]));

const dashboard = (userId: string, mode: Mode) => asUser(userId, (db) => getDashboard(db, mode));

function categoryTotal(d: Awaited<ReturnType<typeof dashboard>>) {
  return d.categories.reduce((sum, c) => sum + c.count, 0);
}

async function currentDocumentsOfKind(kinds: string[]) {
  const rows = await owner()`
    select r.category, count(*)::int as n
    from documents d join records r on r.id = d.record_id join owners o on o.id = r.owner_id
    where d.is_current and o.kind::text = any(${kinds})
    group by r.category
  `;
  return Object.fromEntries(rows.map((row) => [row.category as string, row.n as number]));
}

describe("the administrator", () => {
  test("Individuals counts every current document of people and the household", async () => {
    const d = await dashboard(USER.priya, "individuals");
    const expected = await currentDocumentsOfKind(["person", "household"]);

    expect(Object.fromEntries(d.categories.filter((c) => c.count > 0).map((c) => [c.category, c.count]))).toEqual(expected);
    // All six, in the product's order, even the empty ones: an overview that
    // drops a category reads as one the vault does not have.
    expect(d.categories.map((c) => c.category)).toEqual([
      "personal", "medical", "business", "financial", "legal", "general",
    ]);
  });

  test("Businesses counts the business's documents and nothing personal", async () => {
    const d = await dashboard(USER.priya, "businesses");
    expect(Object.fromEntries(d.categories.filter((c) => c.count > 0).map((c) => [c.category, c.count]))).toEqual(
      await currentDocumentsOfKind(["business"]),
    );
  });

  test("expiring soon splits by mode, and the two halves are the whole list", async () => {
    const people = await dashboard(USER.priya, "individuals");
    const business = await dashboard(USER.priya, "businesses");

    expect(people.expiring.soon.map((e) => NAMES.get(e.documentId)).sort()).toEqual([
      "danielPassport", "householdHomeInsurance", "rosePassport",
    ]);
    expect(business.expiring.soon.map((e) => NAMES.get(e.documentId))).toEqual(["halePermit"]);
  });

  test("chips are subcategories with documents behind them, most used first", async () => {
    const d = await dashboard(USER.priya, "individuals");

    expect(d.chips.length).toBeGreaterThan(0);
    expect(d.chips.length).toBeLessThanOrEqual(8);
    expect(d.chips.every((chip) => chip.count > 0)).toBe(true);
    expect(d.chips.map((c) => c.count)).toEqual([...d.chips.map((c) => c.count)].sort((a, b) => b - a));
    expect(d.chips.map((c) => c.label)).toContain("Passports");
    expect((await dashboard(USER.priya, "businesses")).chips.map((c) => c.label)).not.toContain("Passports");
  });

  test("the tree comes with it", async () => {
    const d = await dashboard(USER.priya, "individuals");
    expect(d.tree.people.length).toBe(11);
    expect(d.tree.businesses.map((b) => b.ownerId)).toEqual([OWNER.hale]);
  });
});

describe("everybody else gets their own answer", () => {
  test("Maya has no business to show", async () => {
    const d = await dashboard(USER.maya, "businesses");

    expect(categoryTotal(d)).toBe(0);
    expect(d.expiring.soon).toEqual([]);
    expect(d.chips).toEqual([]);
    expect(d.tree.businesses).toEqual([]);
  });

  test("Maya's individuals are her reach, not the household's", async () => {
    const d = await dashboard(USER.maya, "individuals");

    // Her own count, read the plain way: whatever the policies let her see.
    // She reaches no business, so all of it is Individuals.
    const plain = await asUser(USER.maya, async (db) => {
      const [row] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from documents where is_current`,
      );
      return row.n;
    });

    expect(categoryTotal(d)).toBe(plain);
    expect(d.expiring.soon.map((e) => NAMES.get(e.documentId)).sort()).toEqual([
      "danielPassport", "householdHomeInsurance", "rosePassport",
    ]);
  });

  test("Daniel sees the business he was granted", async () => {
    const d = await dashboard(USER.daniel, "businesses");
    expect(d.tree.businesses.map((b) => b.ownerId)).toEqual([OWNER.hale]);
    expect(d.expiring.soon.map((e) => NAMES.get(e.documentId))).toEqual(["halePermit"]);
  });

  test("a record whose owner is hidden counts under Individuals, with no owner", async () => {
    const d = await dashboard(USER.sam, "individuals");
    expect(d.categories.find((c) => c.category === "legal")?.count).toBe(1);
    expect(categoryTotal(d)).toBe(1);
    expect(d.tree.people).toEqual([]);
  });

  test("an unattached account sees an empty dashboard, not an error", async () => {
    for (const mode of ["individuals", "businesses"] as const) {
      const d = await dashboard(USER.stranger, mode);
      expect([categoryTotal(d), d.expiring.soon.length, d.chips.length, d.tree.people.length]).toEqual([0, 0, 0, 0]);
    }
  });

  test("no number travels with it", async () => {
    const payload = JSON.stringify(await dashboard(USER.priya, "individuals"));
    expect(payload).not.toContain("FIXTURE-");
    expect(payload).not.toMatch(/identifier/i);
  });
});
