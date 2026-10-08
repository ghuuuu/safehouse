/**
 * Breaking the glass, and closing it (D19, Step 17).
 *
 * The emergency contact opens their own window. That is the point of the
 * feature: it exists for the day the admin cannot be reached, so "ask the
 * admin" is not an answer. What stops it being a skeleton key is all here,
 * and all in the database:
 *
 *   * only an emergency contact, only for themselves, with a reason;
 *   * never longer than the household's setting, which never exceeds the
 *     ceiling in code (settings.test.ts);
 *   * every opening writes an alert to every active admin, by trigger, so no
 *     code path can open a window quietly;
 *   * only an admin closes one early, and nobody can extend one.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { USER } from "./fixture";
import { asUserRollingBack, closeTestDatabase, owner, prepareTestDatabase, refusal } from "./test-harness";

beforeAll(async () => {
  await prepareTestDatabase();
}, 60_000);

afterAll(closeTestDatabase);

type Sql = Parameters<Parameters<typeof asUserRollingBack>[1]>[0];

const open = (sql: Sql, userId: string, hours = 24, reason = "Rose was taken to hospital") => sql`
  insert into emergency_activations (user_id, expires_at, reason)
  values (${userId}, now() + make_interval(hours => ${hours}), ${reason})
`;
// No `returning`: it would need the read policy too, and a refusal from that
// would pass for the insert policy's refusal.

async function reach(sql: Sql, userId: string) {
  await sql`select set_config('safehouse.user_id', ${userId}, true)`;
  return (await sql`select id from documents`).length;
}

describe("opening a window", () => {
  test("an emergency contact opens their own, and reaches the critical papers", async () => {
    const [before, after] = await asUserRollingBack(USER.lapsed, async (sql) => {
      const before = await reach(sql, USER.lapsed);
      await open(sql, USER.lapsed);
      return [before, await reach(sql, USER.lapsed)];
    });

    const [medic] = await asUserRollingBack(USER.medic, async (sql) => [await reach(sql, USER.medic)]);
    expect(before).toBe(0);
    expect(after).toBe(medic);
  });

  test("every active admin is alerted, by the database, in the same transaction", async () => {
    const alerts = await asUserRollingBack(USER.lapsed, async (sql) => {
      await open(sql, USER.lapsed);
      await sql`select set_config('safehouse.user_id', ${USER.priya}, true)`;
      // created_at defaults to now(), the transaction's own timestamp: these are
      // the rows this opening wrote, not the fixture's.
      return sql`select user_id, kind, subject_type, subject_id from notifications where created_at = now()`;
    });

    expect(alerts.map((a) => [a.user_id, a.kind, a.subject_type, a.subject_id])).toEqual([
      [USER.priya, "emergency.activated", "user", USER.lapsed],
    ]);
  });

  test("not longer than the household's setting", async () => {
    const error = await asUserRollingBack(USER.lapsed, (sql) => refusal(() => open(sql, USER.lapsed, 25)));
    expect(error?.code).toBe("42501");
  });

  test("not without a reason", async () => {
    const error = await asUserRollingBack(USER.lapsed, (sql) => refusal(() => open(sql, USER.lapsed, 24, "")));
    expect(error?.code).toBe("42501");
  });

  test("not backdated, and not already revoked", async () => {
    const backdated = await asUserRollingBack(USER.lapsed, (sql) =>
      refusal(() => sql`
        insert into emergency_activations (user_id, activated_at, expires_at, reason)
        values (${USER.lapsed}, now() - interval '3 days', now() + interval '1 hour', 'old')
      `),
    );
    const revoked = await asUserRollingBack(USER.lapsed, (sql) =>
      refusal(() => sql`
        insert into emergency_activations (user_id, expires_at, revoked_at, reason)
        values (${USER.lapsed}, now() + interval '1 hour', now(), 'odd')
      `),
    );
    expect([backdated?.code, revoked?.code]).toEqual(["42501", "42501"]);
  });

  test.each([
    ["for another contact", USER.lapsed, USER.pulled],
    ["by a member", USER.maya, USER.maya],
    ["by the admin", USER.priya, USER.priya],
    ["by a third party", USER.sam, USER.sam],
  ])("not %s", async (_how, actor, subject) => {
    const error = await asUserRollingBack(actor, (sql) => refusal(() => open(sql, subject)));
    expect(error?.code).toBe("42501");
  });

  test("a disabled contact cannot open one", async () => {
    await owner()`update users set disabled_at = now() where id = ${USER.lapsed}`;
    try {
      const error = await asUserRollingBack(USER.lapsed, (sql) => refusal(() => open(sql, USER.lapsed)));
      expect(error?.code).toBe("42501");
    } finally {
      await owner()`update users set disabled_at = null where id = ${USER.lapsed}`;
    }
  });
});

describe("closing one", () => {
  const revoke = (sql: Sql, by: string) => sql`
    update emergency_activations set revoked_at = now(), revoked_by = ${by}
    where user_id = ${USER.medic} and revoked_at is null
    returning id
  `;

  test("the admin closes it, and the contact's reach goes with it", async () => {
    const [closed, after] = await asUserRollingBack(USER.priya, async (sql) => {
      const closed = (await revoke(sql, USER.priya)).length;
      return [closed, await reach(sql, USER.medic)];
    });
    expect([closed, after]).toEqual([1, 0]);
  });

  test("the admin cannot close it in somebody else's name", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) => refusal(() => revoke(sql, USER.maya)));
    expect(error?.code).toBe("42501");
  });

  test.each([
    ["the contact", USER.medic],
    ["a member", USER.maya],
  ])("%s cannot close it", async (_who, actor) => {
    const closed = await asUserRollingBack(actor, async (sql) => (await revoke(sql, actor)).length);
    expect(closed).toBe(0);
  });

  test("nobody can extend one, the admin included", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`update emergency_activations set expires_at = now() + interval '30 days' where user_id = ${USER.medic}`),
    );
    expect(error?.code).toBe("42501");
  });

  test("nothing is ever deleted", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`delete from emergency_activations where user_id = ${USER.medic}`),
    );
    expect(error?.code).toBe("42501");
  });
});

describe("through the application's functions", () => {
  let asUser: typeof import("../db.server").asUser;
  let emergency: typeof import("../emergency.server");

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
    url.username = "safehouse_app";
    url.password = process.env.APP_DB_PASSWORD!;
    process.env.APP_DATABASE_URL = url.toString();
    ({ asUser } = await import("../db.server"));
    emergency = await import("../emergency.server");
  });

  afterAll(async () => {
    await owner()`delete from notifications where kind = 'emergency.activated' and subject_id = ${USER.lapsed} and created_at > now() - interval '1 minute'`;
    await owner()`delete from emergency_activations where user_id = ${USER.lapsed} and reason = 'Fictional: a test opened this'`;
    await owner()`update emergency_activations set revoked_at = null, revoked_by = null where user_id = ${USER.medic}`;
  });

  test("a contact opens one, the admin sees it with its reason, and closes it", async () => {
    expect(await asUser(USER.lapsed, (db) => emergency.openWindow(db, "Fictional: a test opened this"))).toEqual({ ok: true });

    const seen = await asUser(USER.priya, (db) => emergency.openWindows(db));
    expect(seen.map((w) => w.userId).sort()).toEqual([USER.lapsed, USER.medic].sort());
    expect(seen.find((w) => w.userId === USER.lapsed)?.reason).toBe("Fictional: a test opened this");

    expect(await asUser(USER.priya, (db) => emergency.revokeWindows(db, USER.lapsed))).toBe(1);
    expect((await asUser(USER.priya, (db) => emergency.openWindows(db))).map((w) => w.userId)).toEqual([USER.medic]);
  });

  test("a contact sees only their own window", async () => {
    const seen = await asUser(USER.medic, (db) => emergency.openWindows(db));
    expect(seen.map((w) => w.userId)).toEqual([USER.medic]);
  });

  test("a reason is required, in words", async () => {
    expect(await asUser(USER.lapsed, (db) => emergency.openWindow(db, " "))).toMatchObject({ ok: false });
  });

  test("a member asking to revoke closes nothing", async () => {
    expect(await asUser(USER.maya, (db) => emergency.revokeWindows(db, USER.medic))).toBe(0);
  });
});
