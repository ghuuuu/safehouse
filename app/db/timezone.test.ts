/**
 * Today is the household's today (audit, 2026-10-21).
 *
 * "Expires today" and the days left come from the database's `current_date`,
 * and the dashboard's date line from Node. Both follow `TZ`. With the database
 * on UTC, a household seven hours ahead was told a day late every morning.
 *
 * Its own file: `TZ` has to be set before the connection is made.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";

import { USER } from "./fixture";
import { closeTestDatabase, prepareTestDatabase } from "./test-harness";

// Fourteen hours ahead of UTC: a different calendar day for most of every day.
process.env.TZ = "Pacific/Kiritimati";

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
  await closeTestDatabase();
});

test("the database's today is the server's today, in the household's time zone", async () => {
  const [row] = await asUser(USER.priya, (db) =>
    db.execute<{ today: string; zone: string }>(sql`select current_date::text as today, current_setting('TimeZone') as zone`),
  );
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");

  expect(row.zone).toBe("Pacific/Kiritimati");
  expect(row.today).toBe(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
});
