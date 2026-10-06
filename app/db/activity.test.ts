/**
 * The log of who looked at what, and the ways it must not be rewritable.
 *
 * Written before the policy (CLAUDE.md). The table and its read policy have
 * existed since the first migration; nothing has ever been able to write to it.
 *
 * Two obligations rest on this existing. D14 accepts that record field values
 * sit readable in the database, and one of the things it takes on in exchange
 * is that every reveal of a masked value is written here. D19 requires the same
 * for every access made during an emergency window. Both are promises about a
 * log that cannot be quietly edited afterwards.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { DOCUMENT, USER } from "./fixture";
import {
  asUserRollingBack,
  closeTestDatabase,
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

function logEvent(
  sql: Sql,
  options: { actor?: string; actingAs?: string | null; action?: string } = {},
) {
  return sql`
    insert into activity_events (actor_user_id, acting_as_user_id, action, subject_type, subject_id)
    values (
      ${options.actor ?? USER.maya}, ${options.actingAs ?? null},
      ${options.action ?? "document.downloaded"}, 'document', ${DOCUMENT.mayaPassport}
    )
  `;
}

describe("who may write to the log", () => {
  test("a signed-in user records their own action", async () => {
    const error = await asUserRollingBack(USER.maya, (sql) =>
      refusal(() => logEvent(sql)),
    );

    expect(error).toBeNull();
  });

  test("nobody can write an event in somebody else's name", async () => {
    // A log an actor can forge entries in is not a log. The actor is taken
    // from the transaction, not from the row.
    const error = await asUserRollingBack(USER.maya, (sql) =>
      refusal(() => logEvent(sql, { actor: USER.daniel })),
    );

    expect(error?.code).toBe("42501");
  });

  test("not even the admin can write in somebody else's name", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => logEvent(sql, { actor: USER.maya })),
    );

    expect(error?.code).toBe("42501");
  });

  test("an admin records who they were acting as", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => logEvent(sql, { actor: USER.priya, actingAs: USER.maya })),
    );

    expect(error).toBeNull();
  });

  test("a non-admin cannot claim to have been acting as somebody", async () => {
    // Only an admin can borrow eyes, so only an admin can have borrowed them.
    const error = await asUserRollingBack(USER.maya, (sql) =>
      refusal(() => logEvent(sql, { actor: USER.maya, actingAs: USER.daniel })),
    );

    expect(error?.code).toBe("42501");
  });

  test("an emergency contact's access is recordable", async () => {
    // D19 requires every access during a window to be logged, so the role that
    // breaks the glass has to be able to write the line that says so.
    const error = await asUserRollingBack(USER.medic, (sql) =>
      refusal(() => logEvent(sql, { actor: USER.medic })),
    );

    expect(error).toBeNull();
  });

  test("a transaction with no user set writes nothing", async () => {
    const error = await asUserRollingBack(null, (sql) =>
      refusal(() => logEvent(sql, { actor: USER.maya })),
    );

    expect(error?.code).toBe("42501");
  });
});

describe("what cannot be done to the log", () => {
  test("an entry cannot be edited", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`update activity_events set action = 'nothing.happened'`),
    );

    expect(error?.code).toBe("42501");
  });

  test("an entry cannot be deleted", async () => {
    // The whole value of the log is that somebody who did something cannot
    // then remove the line saying so.
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`delete from activity_events`),
    );

    expect(error?.code).toBe("42501");
  });
});

describe("who may read it", () => {
  test("the admin reads the whole log", async () => {
    const rows = await asUserRollingBack(
      USER.priya,
      (sql) => sql`select id from activity_events`,
    );

    expect(rows.length).toBeGreaterThan(0);
  });

  test("an ordinary account reads nothing, including its own entries", async () => {
    // The fixture has an event with Maya as the actor. A log that shows people
    // their own entries is a log that tells them what is recorded about them,
    // which is the start of knowing what is not.
    const rows = await asUserRollingBack(
      USER.maya,
      (sql) => sql`select id from activity_events`,
    );

    expect(rows).toHaveLength(0);
  });
});
