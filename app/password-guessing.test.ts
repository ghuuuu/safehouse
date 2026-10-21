/**
 * Guessing a password (audit, 2026-10-21).
 *
 * Five tries per account per quarter hour, at every door that takes one: the
 * sign-in page, the library's own endpoints under /api/auth, and the step-up
 * check before a file opens. Counted per account rather than per address: the
 * server sits behind nothing that could vouch for an address, so a client
 * would simply name a new one on every try.
 *
 * Its own file because the count lives in memory, and a test here that locks
 * an account would otherwise lock it for every test after it.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { USER } from "./db/fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./db/test-harness";

const testUrl = (role: string, password: string) => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = role;
  url.password = password;
  return url.toString();
};

process.env.AUTH_DATABASE_URL = testUrl("safehouse_auth", process.env.AUTH_DB_PASSWORD!);
process.env.APP_DATABASE_URL = testUrl("safehouse_app", process.env.APP_DB_PASSWORD!);

const { auth, passwordMatches } = await import("./auth.server");
const { spendTry, TOO_MANY_TRIES, TRIES, WINDOW_MS } = await import("./tries.server");

const PASSWORD = "correct-horse-battery-staple";

beforeAll(async () => {
  await prepareTestDatabase();
  const context = await auth.$context;
  const hash = await context.password.hash(PASSWORD);
  for (const userId of [USER.priya, USER.maya, USER.daniel, USER.ivy, USER.rose]) {
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
  const h = new Headers(headers);
  h.set("content-type", "application/json");
  return auth.handler(
    new Request(`http://localhost:4021/api/auth${path}`, { method: "POST", headers: h, body: JSON.stringify(body) }),
  );
}

/** The sign-in page's action, which calls the library directly, not over HTTP. */
async function signInPage(email: string, password: string) {
  const { action } = await import("./routes/sign-in");
  return action({
    request: new Request("http://localhost:4021/sign-in", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password }),
    }),
    params: {},
    context: {} as never,
    url: new URL("http://localhost:4021/sign-in"),
    pattern: "/sign-in",
  });
}

describe("signing in", () => {
  test("after five wrong passwords the right one is refused too, for that account only", async () => {
    for (let i = 0; i < TRIES; i++) {
      expect((await post("/sign-in/email", { email: "maya@example.invalid", password: `guess-number-${i}` })).status).toBe(401);
    }

    const right = await post("/sign-in/email", { email: "maya@example.invalid", password: PASSWORD });
    expect(right.status).toBe(429);
    expect(right.headers.getSetCookie()).toEqual([]);

    // Somebody else's account is untouched.
    expect((await post("/sign-in/email", { email: "priya@example.invalid", password: PASSWORD })).status).toBe(200);
  });

  test("the sign-in page counts against the same account, and says why it refuses", async () => {
    for (let i = 0; i < TRIES; i++) {
      expect(await signInPage("daniel@example.invalid", `guess-number-${i}`)).toEqual({ error: "That email and password do not match." });
    }
    expect(await signInPage("daniel@example.invalid", PASSWORD)).toEqual({ error: TOO_MANY_TRIES });
    // And the other door is shut as well: it is one count per account.
    expect((await post("/sign-in/email", { email: "daniel@example.invalid", password: PASSWORD })).status).toBe(429);
  });

  test("the address is not case-sensitive, so it is not a way round the count", async () => {
    for (let i = 0; i < TRIES; i++) {
      await post("/sign-in/email", { email: i % 2 ? "IVY@example.invalid" : "ivy@EXAMPLE.invalid", password: `guess-number-${i}` });
    }
    expect((await post("/sign-in/email", { email: "ivy@example.invalid", password: PASSWORD })).status).toBe(429);
  });

  test("the right password before the limit starts the count again", async () => {
    for (let i = 0; i < TRIES - 1; i++) await post("/sign-in/email", { email: "rose@example.invalid", password: `guess-number-${i}` });
    expect((await post("/sign-in/email", { email: "rose@example.invalid", password: PASSWORD })).status).toBe(200);

    for (let i = 0; i < TRIES - 1; i++) await post("/sign-in/email", { email: "rose@example.invalid", password: `guess-number-${i}` });
    expect((await post("/sign-in/email", { email: "rose@example.invalid", password: PASSWORD })).status).toBe(200);
  });
});

describe("confirming it is you", () => {
  test("the step-up check stops answering after five wrong passwords", async () => {
    expect(await passwordMatches(USER.priya, PASSWORD)).toBe("match");
    for (let i = 0; i < TRIES; i++) expect(await passwordMatches(USER.priya, `guess-number-${i}`)).toBe("wrong");
    expect(await passwordMatches(USER.priya, PASSWORD)).toBe("locked");
  });

  test("the library's own password endpoints share that count", async () => {
    // A stolen session cannot sidestep step-up by guessing through
    // change-password instead: it is the same account's count.
    const signedIn = await post("/sign-in/email", { email: "priya@example.invalid", password: PASSWORD });
    // Priya's sign-in count is separate from her step-up count, so this works.
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

    const change = await post(
      "/change-password",
      { currentPassword: PASSWORD, newPassword: "a-new-password-long-enough" },
      { cookie, origin: "http://localhost:4021" },
    );
    expect(change.status).toBe(429);
  });
});

describe("the count itself", () => {
  test("allows five tries in a window, then none until it has passed", () => {
    const start = 1_000_000;
    for (let i = 0; i < TRIES; i++) expect(spendTry("unit:window", start + i)).toBe(true);
    expect(spendTry("unit:window", start + WINDOW_MS - 1)).toBe(false);
    expect(spendTry("unit:window", start + WINDOW_MS)).toBe(true);
  });
});
