/**
 * What is about to expire, and who is allowed to be told.
 *
 * Two assertions carry the weight. The first is that an unconfirmed date raises
 * nothing: a reader proposes expiry dates now (D26), and a vault that nagged
 * about a machine's guess would teach its household to ignore it. The second is
 * that the list is a vault query like any other — a reminder may not name a
 * document the viewer cannot open, which is the one rule in CLAUDE.md.
 *
 * The fixture's relative dates are what make this testable at all: 12, 26, 45,
 * 58, 67, 74, 89 and 103 days out, plus one 40 days gone. The pairs that
 * straddle a boundary are there on purpose.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { findExpiring } from "../expiry.server";
import { DOCUMENT, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

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

afterAll(async () => {
  await owner()`update settings set expiry_reminder_lead_days = 60 where id = 1`;
  await closeTestDatabase();
});

async function leadDaysBecomes(days: number): Promise<void> {
  await owner()`
    update settings set expiry_reminder_lead_days = ${days} where id = 1
  `;
}

/** The ids only — every assertion here is about which documents are named. */
async function expiringFor(userId: string): Promise<string[]> {
  const { soon } = await asUser(userId, (db) => findExpiring(db));
  return soon.map((row) => row.documentId);
}

describe("the window", () => {
  test("a date inside the lead window appears, one just outside it does not", async () => {
    const ids = await expiringFor(USER.priya);

    // 58 days and 67 days, either side of the household's sixty.
    expect(ids).toContain(DOCUMENT.householdHomeInsurance);
    expect(ids).not.toContain(DOCUMENT.householdApplianceWarranty);
  });

  test("the window is the household's setting, not a constant in the code", async () => {
    await leadDaysBecomes(95);

    const ids = await expiringFor(USER.priya);

    // 89 days and 103 days, either side of the ninety-five just set.
    expect(ids).toContain(DOCUMENT.ivyInsuranceCard);
    expect(ids).not.toContain(DOCUMENT.haleInsurancePolicy);

    await leadDaysBecomes(60);
  });

  test("something already expired is still said, and said first", async () => {
    const { soon } = await asUser(USER.priya, (db) => findExpiring(db));

    // Forty days gone. A vault that only warns about the future stops
    // mentioning the passport on the morning it actually matters.
    expect(soon[0]?.documentId).toBe(DOCUMENT.danielPassport);
    expect(soon[0]?.daysLeft).toBeLessThan(0);
  });

  test("a superseded version is not nagged about", async () => {
    // The old trading permit expired in 2025 and its expiry is confirmed in the
    // fixture. Only `is_current` keeps it out, which is why it is confirmed.
    expect(await expiringFor(USER.priya)).not.toContain(DOCUMENT.halePermitOld);
  });
});

describe("what nobody confirmed", () => {
  test("an expiry date no human agreed with raises nothing", async () => {
    // The office lease runs out in 45 days, well inside the window, and is the
    // one relative date in the fixture left unconfirmed (D26).
    expect(await expiringFor(USER.priya)).not.toContain(
      DOCUMENT.haleLeaseContract,
    );
  });
});

describe("who is told", () => {
  test("a reminder never names a document the viewer cannot open", async () => {
    const { soon } = await asUser(USER.sam, (db) => findExpiring(db));

    const readable = await asUser(USER.sam, async (db) => {
      const rows = await db.execute<{ id: string }>(
        sql`select id from documents`,
      );
      return new Set([...rows].map((row) => row.id));
    });

    expect(soon.length).toBeGreaterThan(0);
    for (const row of soon) expect(readable.has(row.documentId)).toBe(true);
  });

  test("the accountant is not told about the family's passports", async () => {
    // Rose's passport expires in twelve days. Sam's grants reach the business
    // and nothing else, so the most urgent thing in the vault is none of his
    // business.
    expect(await expiringFor(USER.sam)).not.toContain(DOCUMENT.rosePassport);
    expect(await expiringFor(USER.priya)).toContain(DOCUMENT.rosePassport);
  });

  test("an account attached to nobody is told nothing", async () => {
    expect(await expiringFor(USER.stranger)).toEqual([]);
  });

  test("a request that never said who is asking is told nothing", async () => {
    // The shape of a bug that skipped `withVault`. Settings is behind the same
    // `current_app_user() is not null` rule as everything else, so there is no
    // lead window to read and nothing to compare against.
    const { leadDays, soon } = await asUser("", (db) => findExpiring(db));

    expect(soon).toEqual([]);
    expect(leadDays).toBeNull();
  });
});
