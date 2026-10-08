/**
 * The wall between signing in and reading the vault (D24).
 *
 * Safehouse has two database roles doing two jobs. `safehouse_auth` checks
 * passwords and keeps sessions; `safehouse_app` reads documents. Neither can do
 * the other's work, and these tests are what keeps that true — because the
 * failure they guard against is silent. Granting one extra table to the auth
 * role would break nothing, pass every other test, and hand the half of the
 * system that talks to anonymous strangers a way into the will.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { USER } from "./fixture";
import {
  asAuthRole,
  asUser,
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

describe("the sign-in role cannot read the vault", () => {
  const vaultTables = [
    "records",
    "documents",
    "document_files",
    "owners",
    "people",
    "businesses",
    "relationships",
    "grant_owners",
    "grant_categories",
    "grant_records",
    "emergency_activations",
    "activity_events",
    "notifications",
    "settings",
    "subcategories",
  ];

  test.each(vaultTables)("it is refused %s outright", async (table) => {
    const error = await refusal(() =>
      asAuthRole((sql) => sql.unsafe(`select * from ${table} limit 1`)),
    );

    // 42501 is insufficient_privilege. Not "no rows came back" — the query is
    // rejected before it runs, which is a failure nobody can mistake for a
    // quiet afternoon.
    expect(error?.code, `${table} was readable by safehouse_auth`).toBe("42501");
  });

  test("it cannot read the permission views either", async () => {
    // Named for what they are since 0004: the views live in `perm`, and no
    // role the application connects as has USAGE on that schema.
    const error = await refusal(() =>
      asAuthRole((sql) => sql`select * from perm.visible_record limit 1`),
    );

    expect(error?.code).toBe("42501");
  });
});

describe("the vault role cannot read credentials", () => {
  test.each(["accounts", "sessions", "verifications", "two_factors"])(
    "%s is out of reach, policy or no policy",
    async (table) => {
      const error = await refusal(() =>
        asUser(USER.priya, (sql) =>
          sql.unsafe(`select * from ${table} limit 1`),
        ),
      );

      // Priya is the admin — the most privileged account there is. The password
      // hashes are still not hers to read.
      expect(error?.code, `${table} was readable by safehouse_app`).toBe(
        "42501",
      );
    },
  );
});

describe("what the sign-in role can do", () => {
  test("it finds a user by email, which is what signing in needs", async () => {
    // The one operation that has to happen before anyone knows who is asking.
    // No policy can express it, which is why this role exists at all.
    const rows = await asAuthRole(
      (sql) => sql`select id from users where email = 'maya@example.invalid'`,
    );

    expect(rows.map((r) => r.id)).toEqual([USER.maya]);
  });

  test("it opens and closes a session", async () => {
    const token = `test-token-${Date.now()}`;

    const created = await asAuthRole(async (sql) => {
      const rows = await sql`
        insert into sessions (user_id, token, expires_at)
        values (${USER.maya}, ${token}, now() + interval '1 day')
        returning id
      `;
      await sql`delete from sessions where token = ${token}`;
      return rows;
    });

    expect(created).toHaveLength(1);
  });

  test("it cannot promote anybody by writing to the vault", async () => {
    // It can write to `users` — that is how sign-up works. What it cannot do is
    // reach past that table, so a compromised sign-in path cannot grant itself
    // an owner and read the house deed.
    const error = await refusal(() =>
      asAuthRole(
        (sql) => sql`insert into grant_owners (user_id, owner_id)
                     values (${USER.stranger}, ${USER.stranger})`,
      ),
    );

    expect(error?.code).toBe("42501");
  });
});

describe("an account that is not yet anybody", () => {
  // A new account exists before the admin attaches it to a person in the tree.
  // Between those two moments it must be inert, because that gap is exactly
  // what a stranger who talked their way through sign-up would be standing in.

  test("it reaches no owners at all", async () => {
    const rows = await asUser(
      USER.stranger,
      (sql) => sql`select id from owners`,
    );

    expect(rows).toHaveLength(0);
  });

  test("it does not get the household's papers", async () => {
    // The rule this replaced said every `individual` shares the household's
    // own records — the deed, the marriage certificate. Read literally, that
    // included an account belonging to nobody.
    const rows = await asUser(
      USER.stranger,
      (sql) => sql`select id from records`,
    );

    expect(rows).toHaveLength(0);
  });

  test("it downloads no files", async () => {
    const rows = await asUser(
      USER.stranger,
      (sql) => sql`select id from document_files`,
    );

    expect(rows).toHaveLength(0);
  });

  test("a household member still gets the household's papers", async () => {
    // The other half of the same rule: tightening it must not have cost Maya
    // the deed.
    const rows = await asUser(
      USER.maya,
      (sql) => sql`select r.id from records r
                   join owners o on o.id = r.owner_id
                   where o.kind = 'household'`,
    );

    expect(rows.length).toBeGreaterThan(0);
  });
});
