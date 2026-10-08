/**
 * The household's settings (Step 16, D19, D36).
 *
 * Three numbers, and who may change them. The emergency window is the one
 * that matters: D19 says its ceiling is a constant in code rather than a
 * setting, "because a setting that can be raised without limit is not a
 * ceiling". So the ceiling is enforced twice — in TypeScript, where the form
 * is checked, and by a check constraint, where nothing can talk its way past
 * it — and the last test here keeps the two equal.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { EMERGENCY_CEILING_HOURS } from "../settings";
import { USER } from "./fixture";
import { asUserRollingBack, closeTestDatabase, owner, prepareTestDatabase, refusal } from "./test-harness";

beforeAll(async () => {
  await prepareTestDatabase();
}, 60_000);

afterAll(closeTestDatabase);

type Sql = Parameters<Parameters<typeof asUserRollingBack>[1]>[0];

const set = (column: string, value: number) => (sql: Sql) =>
  sql.unsafe(`update settings set ${column} = ${value} where id = 1 returning ${column}`);

describe("the administrator", () => {
  test.each([
    ["expiry_reminder_lead_days", 30],
    ["emergency_window_hours", 48],
    ["auto_lock_minutes", 10],
  ])("may change %s", async (column, value) => {
    const rows = await asUserRollingBack(USER.priya, set(column, value));
    expect(rows[0][column]).toBe(value);
  });

  test("may not raise the emergency window past the ceiling in code", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => set("emergency_window_hours", EMERGENCY_CEILING_HOURS + 1)(sql)),
    );
    expect(error?.code).toBe("23514");
  });

  test.each([
    ["expiry_reminder_lead_days", 0],
    ["expiry_reminder_lead_days", 366],
    ["emergency_window_hours", 0],
    ["auto_lock_minutes", 4],
    ["auto_lock_minutes", 241],
  ])("may not set %s to %i", async (column, value) => {
    const error = await asUserRollingBack(USER.priya, (sql) => refusal(() => set(column, value)(sql)));
    expect(error?.code).toBe("23514");
  });

  test("may not touch the row's id, or add a second row", async () => {
    const id = await asUserRollingBack(USER.priya, (sql) => refusal(() => sql`update settings set id = 2`));
    const insert = await asUserRollingBack(USER.priya, (sql) => refusal(() => sql`insert into settings (id) values (2)`));
    expect([id?.code, insert?.code]).toEqual(["42501", "42501"]);
  });
});

describe("nobody else", () => {
  test.each([
    ["a member", USER.maya],
    ["a third party", USER.sam],
    ["an emergency contact with an open window", USER.medic],
    ["a transaction that never said who it was", null],
  ])("%s changes nothing", async (_who, userId) => {
    const rows = await asUserRollingBack(userId, set("emergency_window_hours", 72));
    expect(rows).toHaveLength(0);
    const [row] = await owner()`select emergency_window_hours from settings`;
    expect(row.emergency_window_hours).toBe(24);
  });

  test("a disabled administrator changes nothing", async () => {
    await owner()`update users set disabled_at = now() where id = ${USER.priya}`;
    try {
      const rows = await asUserRollingBack(USER.priya, set("emergency_window_hours", 72));
      expect(rows).toHaveLength(0);
    } finally {
      await owner()`update users set disabled_at = null where id = ${USER.priya}`;
    }
  });
});

test("the ceiling in code is the ceiling in the database", async () => {
  const [row] = await owner()`
    select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'settings_emergency_window_ceiling'
  `;
  expect(row.def).toContain(`<= ${EMERGENCY_CEILING_HOURS}`);
});
