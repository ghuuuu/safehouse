/**
 * Signing in, end to end, against the real database.
 *
 * The pieces this covers are the ones where a mistake is invisible from the
 * outside: an unlocked sign-up endpoint still renders a normal-looking form,
 * and a session that names the wrong user still shows somebody a vault.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { sql } from "drizzle-orm";

import { RECORD, USER } from "./db/fixture";
import {
  closeTestDatabase,
  owner,
  prepareTestDatabase,
} from "./db/test-harness";

// Point both connections at the test database before the modules that read
// these read them. The auth module opens its connection at import.
const testUrl = (role: string, password: string) => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = role;
  url.password = password;
  return url.toString();
};

process.env.AUTH_DATABASE_URL = testUrl(
  "safehouse_auth",
  process.env.AUTH_DB_PASSWORD!,
);
process.env.APP_DATABASE_URL = testUrl(
  "safehouse_app",
  process.env.APP_DB_PASSWORD!,
);

const { auth } = await import("./auth.server");
const { getSignedInUser, withVault } = await import("./session.server");
const { resolveViewContext } = await import("./view-as.server");

const PASSWORD = "correct-horse-battery-staple";

beforeAll(async () => {
  await prepareTestDatabase();

  // Give two fixture accounts a password, the way the admin eventually will.
  const context = await auth.$context;
  const hash = await context.password.hash(PASSWORD);

  for (const userId of [USER.priya, USER.maya, USER.tenant]) {
    await owner()`
      insert into accounts (user_id, issuer, account_id, provider_id, password)
      values (${userId}, 'local:credential', ${userId}, 'credential', ${hash})
    `;
  }
}, 60_000);

afterAll(async () => {
  await owner()`delete from sessions`;
  await owner()`delete from accounts`;
  await closeTestDatabase();
});

function post(path: string, body: unknown, headers: HeadersInit = {}) {
  return auth.handler(
    new Request(`http://localhost:4021/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Signs in and returns the cookies a browser would send back — all of them.
 *
 * Every one, not just the session token, because the library can be configured
 * to put a cached copy of the user in a second cookie. A helper that quietly
 * dropped it would make the staleness test below pass for the wrong reason: it
 * would be testing a browser that forgets half of what it was given.
 */
async function signIn(email: string): Promise<string> {
  const response = await post("/sign-in/email", { email, password: PASSWORD });
  expect(response.status, await response.clone().text()).toBe(200);

  const cookies = response.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

describe("who may create an account", () => {
  test("a stranger cannot sign themselves up", async () => {
    // The library serves this endpoint publicly by default. For a household
    // vault that is the wrong answer: an account is a foot in the door.
    const response = await post("/sign-up/email", {
      email: "opportunist@example.invalid",
      name: "Opportunist",
      password: PASSWORD,
    });

    expect(response.status).toBe(403);

    const rows = await owner()`
      select id from users where email = 'opportunist@example.invalid'
    `;
    expect(rows).toHaveLength(0);
  });

  test("a signed-in family member cannot either", async () => {
    const cookie = await signIn("maya@example.invalid");

    const response = await post(
      "/sign-up/email",
      { email: "friend@example.invalid", name: "Friend", password: PASSWORD },
      { cookie },
    );

    expect(response.status).toBe(403);
  });
});

describe("signing in", () => {
  test("it names the right user", async () => {
    const cookie = await signIn("maya@example.invalid");

    const request = new Request("http://localhost:4021/", {
      headers: { cookie },
    });
    const user = await getSignedInUser(request);

    expect(user?.id).toBe(USER.maya);
    expect(user?.role).toBe("individual");
  });

  test("a wrong password gets nothing", async () => {
    const response = await post("/sign-in/email", {
      email: "maya@example.invalid",
      password: "not-the-password",
    });

    expect(response.status).toBe(401);
  });

  test("a disabled account is treated as signed out", async () => {
    // The library has no idea what `disabled_at` means, so the session is
    // issued. The bridge into the vault is where it stops — and the permission
    // views drop disabled users too, so both layers say no.
    const cookie = await signIn("tenant@example.invalid");

    const user = await getSignedInUser(
      new Request("http://localhost:4021/", { headers: { cookie } }),
    );

    expect(user).toBeNull();
  });
});

describe("the cookie decides what the vault shows", () => {
  test("a request reads the vault as whoever signed in", async () => {
    // The whole chain in one assertion: cookie, session row, user id, the
    // transaction setting that names them, and the policies in
    // 0001_permission_layer.sql. Maya can see her own passport record.
    const cookie = await signIn("maya@example.invalid");
    const request = new Request("http://localhost:4021/", {
      headers: { cookie },
    });

    const visible = await withVault(request, async (db, user) => {
      expect(user.id).toBe(USER.maya);
      const rows = await db.execute<{ id: string }>(
        sql`select id from records order by id`,
      );
      return rows.map((row) => row.id);
    });

    expect(visible).toContain(RECORD.mayaPassport);
    // Ivy's counselling notes are private to Ivy. Her mother is not an
    // exception (D17).
    expect(visible).not.toContain(RECORD.ivyCounselling);
  });

  test("no cookie means no vault, not an empty one", async () => {
    // A redirect, thrown rather than returned, so a loader that ignores the
    // result still cannot carry on unauthenticated.
    const request = new Request("http://localhost:4021/records");

    await expect(withVault(request, async () => "reached")).rejects.toSatisfy(
      (thrown) => thrown instanceof Response && thrown.status === 302,
    );
  });
});

describe("what the session says about a role", () => {
  test("an admin demoted mid-session can no longer borrow anybody's eyes", async () => {
    // The gate in view-as.server.ts reads `actor.role` from the session rather
    // than from a vault query, because the question has to be asked while the
    // actor is still themselves. That is only sound if the session's copy of
    // the role is not a copy at all. This is the test that says which it is.
    //
    // It is: better-auth has no session cookie cache configured, so
    // getSession reads the session row and joins the user on every request,
    // and a role changed in the database is in force on the next one. If
    // anybody ever enables `session.cookieCache`, this test fails — and it
    // should, because the gate would then be deciding from a stale copy for
    // the life of the cache.
    const cookie = await signIn("priya@example.invalid");
    const borrowMayasEyes = () =>
      resolveViewContext(
        new Request(`http://localhost:4021/vault?as=${USER.maya}`, {
          headers: { cookie },
        }),
      );

    const asAdmin = await borrowMayasEyes();
    expect(asAdmin.isViewingAs).toBe(true);
    expect(asAdmin.viewedUserId).toBe(USER.maya);

    try {
      await owner()`
        update users set role = 'individual' where id = ${USER.priya}
      `;

      // Same cookie, same session row, same request. The refusal comes from
      // the database's answer to "what is she now", not from signing out.
      await expect(borrowMayasEyes()).rejects.toSatisfy(
        (thrown) => thrown instanceof Response && thrown.status === 403,
      );
    } finally {
      await owner()`update users set role = 'admin' where id = ${USER.priya}`;
    }
  });
});

describe("the sign-in page", () => {
  const signInAction = async (fields: Record<string, string>) => {
    const { action } = await import("./routes/sign-in");
    const body = new URLSearchParams(fields);

    return action({
      request: new Request("http://localhost:4021/sign-in", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
      params: {},
      context: {} as never,
      url: new URL("http://localhost:4021/sign-in"),
      pattern: "/sign-in",
    });
  };

  test("it says the same thing to a wrong password and an unknown address", async () => {
    // Two different messages here would turn the form into a way to ask which
    // of somebody's relatives has an account.
    const wrongPassword = await signInAction({
      email: "maya@example.invalid",
      password: "not-the-password",
    });
    const noSuchUser = await signInAction({
      email: "nobody@example.invalid",
      password: PASSWORD,
    });

    expect(wrongPassword).toEqual(noSuchUser);
    expect(wrongPassword).toHaveProperty("error");
  });

  test("it will not forward somebody off this server", async () => {
    // `next` comes from the query string, so it is the attacker's to choose.
    const result = await signInAction({
      email: "maya@example.invalid",
      password: PASSWORD,
      next: "https://elsewhere.example/collect",
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe("/");
  });

  test("it forwards to a page inside the vault", async () => {
    const result = await signInAction({
      email: "maya@example.invalid",
      password: PASSWORD,
      next: "/records/1",
    });

    expect((result as Response).headers.get("location")).toBe("/records/1");
    expect((result as Response).headers.get("set-cookie")).toBeTruthy();
  });
});

describe("the first-run page", () => {
  test("it is closed once the household exists", async () => {
    const { loader } = await import("./routes/setup");

    await expect(loader()).rejects.toSatisfy(
      (thrown) =>
        thrown instanceof Response &&
        thrown.headers.get("location") === "/sign-in",
    );
  });
});
