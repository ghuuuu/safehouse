/**
 * The notifications table gets a writer (Step 17, D13, D30, D37).
 *
 * Two kinds of row, written two ways. An `emergency.activated` alert is
 * written by the database itself when a window opens (emergency.test.ts), so
 * the application can neither forget it nor forge one. An `expiry.soon` row is
 * written by the delivery sweep, as the recipient, about a document the
 * recipient can see — and only once per document, so a reminder is delivered
 * once rather than every fifteen minutes.
 *
 * Nobody writes a notification for somebody else, and the delivery columns are
 * the recipient's own.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { DOCUMENT, USER } from "./fixture";
import { asUserRollingBack, closeTestDatabase, prepareTestDatabase, refusal } from "./test-harness";

beforeAll(async () => {
  await prepareTestDatabase();
}, 60_000);

afterAll(closeTestDatabase);

type Sql = Parameters<Parameters<typeof asUserRollingBack>[1]>[0];

const remind = (sql: Sql, userId: string, documentId: string, kind = "expiry.soon") => sql`
  insert into notifications (user_id, kind, subject_type, subject_id)
  values (${userId}, ${kind}, 'document', ${documentId})
  returning id
`;

describe("expiry reminders", () => {
  test("the admin writes one for themselves, about a document they can see", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) => refusal(() => remind(sql, USER.priya, DOCUMENT.rosePassport)));
    expect(error).toBeNull();
  });

  test("only once per document", async () => {
    const error = await asUserRollingBack(USER.priya, async (sql) => {
      await remind(sql, USER.priya, DOCUMENT.rosePassport);
      return refusal(() => remind(sql, USER.priya, DOCUMENT.rosePassport));
    });
    expect(error?.code).toBe("23505");
  });

  test("not for somebody else", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) => refusal(() => remind(sql, USER.maya, DOCUMENT.mayaPassport)));
    expect(error?.code).toBe("42501");
  });

  test("not about a document the recipient cannot see", async () => {
    const error = await asUserRollingBack(USER.maya, (sql) => refusal(() => remind(sql, USER.maya, DOCUMENT.ivyCounselling)));
    expect(error?.code).toBe("42501");
  });

  test("and the application cannot forge an emergency alert", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => remind(sql, USER.priya, DOCUMENT.rosePassport, "emergency.activated")),
    );
    expect(error?.code).toBe("42501");
  });

  test("not already marked delivered", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`
        insert into notifications (user_id, kind, subject_type, subject_id, delivered_at)
        values (${USER.priya}, 'expiry.soon', 'document', ${DOCUMENT.rosePassport}, now())
      `),
    );
    expect(error?.code).toBe("42501");
  });
});

describe("delivery and read state", () => {
  test("the recipient records a delivery, a failure, or reading it", async () => {
    const rows = await asUserRollingBack(USER.priya, async (sql) => {
      const [{ id }] = await remind(sql, USER.priya, DOCUMENT.rosePassport);
      return sql`
        update notifications
        set delivery_attempts = 1, delivery_error = 'timed out', read_at = now()
        where id = ${id} returning id
      `;
    });
    expect(rows).toHaveLength(1);
  });

  test("a failure reason is short, so a response body cannot be stored in it", async () => {
    const error = await asUserRollingBack(USER.priya, async (sql) => {
      const [{ id }] = await remind(sql, USER.priya, DOCUMENT.rosePassport);
      return refusal(() => sql`update notifications set delivery_error = ${"x".repeat(81)} where id = ${id}`);
    });
    expect(error?.code).toBe("23514");
  });

  test("nobody touches somebody else's", async () => {
    const changed = await asUserRollingBack(USER.maya, (sql) =>
      sql`update notifications set read_at = now() where user_id = ${USER.priya} returning id`,
    );
    expect(changed).toHaveLength(0);
  });

  test("what a notification is about cannot be rewritten", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`update notifications set subject_id = ${DOCUMENT.mayaPassport} where user_id = ${USER.priya}`),
    );
    expect(error?.code).toBe("42501");
  });

  test("nothing is deleted", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) => refusal(() => sql`delete from notifications`));
    expect(error?.code).toBe("42501");
  });
});
