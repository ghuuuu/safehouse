/**
 * Safekeeping (Step 19, D6, D12, D38): the two things a household must do
 * outside the app, and the vault saying so when they have not been done.
 *
 * A drill that passed is written by the drill script as the owner; the app can
 * only read it, and only an admin can. The key copy is an admin's word that the
 * key is written down somewhere else, recorded against the key's id, so a
 * replaced key asks again.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import { USER } from "./fixture";
import { asUserRollingBack, closeTestDatabase, owner, prepareTestDatabase, refusal } from "./test-harness";

const KEY = "a1b2c3d4";

beforeAll(async () => {
  await prepareTestDatabase();
}, 60_000);

afterAll(closeTestDatabase);

afterEach(async () => {
  await owner()`delete from backup_drills`;
  await owner()`update settings set key_copy_confirmed_for = null`;
});

const drillTaken = (daysAgo: number) => owner()`
  insert into backup_drills (backup_id, backup_taken_at)
  values (${`safehouse-fictional-${daysAgo}`}, now() - make_interval(days => ${daysAgo}))
`;

describe("a passed drill", () => {
  test("is read by an admin", async () => {
    await drillTaken(2);
    const rows = await asUserRollingBack(USER.priya, (sql) => sql`select backup_id from backup_drills`);
    expect(rows).toHaveLength(1);
  });

  test.each([
    ["a member", USER.maya],
    ["a third party", USER.sam],
    ["an emergency contact with an open window", USER.medic],
    ["a transaction that never said who it was", null],
  ])("is read by nobody else: %s", async (_who, userId) => {
    await drillTaken(2);
    const rows = await asUserRollingBack(userId, (sql) => sql`select backup_id from backup_drills`);
    expect(rows).toHaveLength(0);
  });

  test("cannot be written by the application, even as an admin", async () => {
    await drillTaken(2);
    const insert = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`insert into backup_drills (backup_id, backup_taken_at) values ('forged', now())`),
    );
    const update = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`update backup_drills set backup_taken_at = now()`),
    );
    const remove = await asUserRollingBack(USER.priya, (sql) => refusal(() => sql`delete from backup_drills`));
    expect([insert?.code, update?.code, remove?.code]).toEqual(["42501", "42501", "42501"]);
  });
});

describe("the key copy", () => {
  test("is confirmed by an admin, as a key id", async () => {
    const rows = await asUserRollingBack(USER.priya, (sql) =>
      sql`update settings set key_copy_confirmed_for = ${KEY} where id = 1 returning key_copy_confirmed_for`,
    );
    expect(rows[0].key_copy_confirmed_for).toBe(KEY);
  });

  test("is a key id and nothing else", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`update settings set key_copy_confirmed_for = 'the key itself, pasted' where id = 1`),
    );
    expect(error?.code).toBe("23514");
  });

  test("is not confirmed by a member", async () => {
    const rows = await asUserRollingBack(USER.maya, (sql) =>
      sql`update settings set key_copy_confirmed_for = ${KEY} where id = 1 returning 1`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("through the application's functions", () => {
  let asUser: typeof import("../db.server").asUser;
  let safekeeping: typeof import("../safekeeping.server");

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
    url.username = "safehouse_app";
    url.password = process.env.APP_DB_PASSWORD!;
    process.env.APP_DATABASE_URL = url.toString();
    ({ asUser } = await import("../db.server"));
    safekeeping = await import("../safekeeping.server");
  });

  afterAll(async () => {
    await owner()`delete from activity_events where action = 'key.copy-confirmed'`;
  });

  const read = () => asUser(USER.priya, (db) => safekeeping.readSafekeeping(db, KEY));

  test("no drill ever is a drill overdue", async () => {
    expect(await read()).toMatchObject({ drilledBackupAt: null, drillOverdue: true });
  });

  test("a backup drilled within the week is enough, and an older one is not", async () => {
    await drillTaken(9);
    expect(await read()).toMatchObject({ drillOverdue: true });
    await drillTaken(2);
    expect(await read()).toMatchObject({ drillOverdue: false });
  });

  test("what counts is when the backup was taken, not when it was drilled", async () => {
    // A month-old backup drilled today proves last month's vault restores.
    await drillTaken(30);
    expect(await read()).toMatchObject({ drillOverdue: true });
  });

  test("a key copy counts for the key it was confirmed for, and no other", async () => {
    expect((await read()).keyCopyConfirmed).toBe(false);
    await asUser(USER.priya, (db) => safekeeping.confirmKeyCopy(db, KEY));
    expect((await read()).keyCopyConfirmed).toBe(true);
    expect((await asUser(USER.priya, (db) => safekeeping.readSafekeeping(db, "0badc0de"))).keyCopyConfirmed).toBe(false);

    const [logged] = await owner()`select actor_user_id from activity_events where action = 'key.copy-confirmed'`;
    expect(logged.actor_user_id).toBe(USER.priya);
  });
});
