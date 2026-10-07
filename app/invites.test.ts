/**
 * Invites and password resets, which are the same link (D13, D32).
 *
 * Nothing is emailed, so the admin is handed a single-use link and delivers it
 * by hand. An invite is an account with no password plus that link; a reset is
 * the link alone. What these pin down is who may make one, that it opens
 * exactly one account exactly once, and that the endpoint the library serves
 * publicly for the purpose is not public here.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { OWNER, USER } from "./db/fixture";
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

const { auth, inviteToSignIn, NotAllowed, setPasswordWithLink, signInLinkFor } =
  await import("./auth.server");

const PASSWORD = "correct-horse-battery-staple";
const THEO_EMAIL = "theo@example.invalid";

beforeAll(async () => {
  await prepareTestDatabase();

  const context = await auth.$context;
  const hash = await context.password.hash(PASSWORD);

  for (const userId of [USER.priya, USER.maya]) {
    await owner()`
      insert into accounts (user_id, issuer, account_id, provider_id, password)
      values (${userId}, 'local:credential', ${userId}, 'credential', ${hash})
    `;
  }
}, 60_000);

afterAll(async () => {
  // Every row this file can leave behind. The matrix test reads the whole of
  // `users`, so an invited account that outlived this file would fail it.
  await owner()`delete from sessions`;
  await owner()`delete from accounts`;
  await owner()`delete from verifications`;
  await owner()`delete from users where email = ${THEO_EMAIL}`;
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

async function signIn(email: string, password = PASSWORD): Promise<Headers> {
  const response = await post("/sign-in/email", { email, password });
  expect(response.status, await response.clone().text()).toBe(200);

  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

function tokenOf(link: string): string {
  return new URL(link).hash.slice(1);
}

describe("the library's reset endpoint is not public here", () => {
  test("a stranger cannot ask for a link", async () => {
    const response = await post("/request-password-reset", {
      email: "maya@example.invalid",
    });

    expect(response.status).toBe(403);
    expect(await owner()`select id from verifications`).toHaveLength(0);
  });

  test("a signed-in member cannot either", async () => {
    const response = await post(
      "/request-password-reset",
      { email: "priya@example.invalid" },
      await signIn("maya@example.invalid"),
    );

    expect(response.status).toBe(403);
    expect(await owner()`select id from verifications`).toHaveLength(0);
  });
});

describe("who may invite", () => {
  test("not a member of the household", async () => {
    const maya = await signIn("maya@example.invalid");

    await expect(
      inviteToSignIn(maya, { personOwnerId: OWNER.theo, email: THEO_EMAIL, name: "Theo" }),
    ).rejects.toBeInstanceOf(NotAllowed);
    await expect(signInLinkFor(maya, OWNER.maya)).rejects.toBeInstanceOf(NotAllowed);

    expect(await owner()`select id from users where email = ${THEO_EMAIL}`).toHaveLength(0);
  });

  test("not even far enough to learn whether an address has an account", async () => {
    // "Somebody already signs in with that address" is an answer about another
    // account. The refusal has to come before any question is asked.
    const maya = await signIn("maya@example.invalid");

    await expect(
      inviteToSignIn(maya, {
        personOwnerId: OWNER.theo,
        email: "priya@example.invalid",
        name: "Theo",
      }),
    ).rejects.toBeInstanceOf(NotAllowed);
  });

  test("not an admin who has been disabled, through any door", async () => {
    const priya = await signIn("priya@example.invalid");
    await owner()`update users set disabled_at = now() where id = ${USER.priya}`;

    try {
      await expect(signInLinkFor(priya, OWNER.maya)).rejects.toBeInstanceOf(NotAllowed);

      const reset = await post("/request-password-reset", { email: "maya@example.invalid" }, priya);
      expect(reset.status).toBe(403);

      const signUp = await post(
        "/sign-up/email",
        { email: "late@example.invalid", name: "Late", password: PASSWORD },
        priya,
      );
      expect(signUp.status).toBe(403);
    } finally {
      await owner()`update users set disabled_at = null where id = ${USER.priya}`;
    }
  });

  test("not somebody who is not signed in at all", async () => {
    await expect(
      inviteToSignIn(new Headers(), {
        personOwnerId: OWNER.theo,
        email: THEO_EMAIL,
        name: "Theo",
      }),
    ).rejects.toBeInstanceOf(NotAllowed);
  });
});

describe("an invite", () => {
  test("makes an account on the person, with no password, and a link", async () => {
    const priya = await signIn("priya@example.invalid");

    const invited = await inviteToSignIn(priya, {
      personOwnerId: OWNER.theo,
      email: ` ${THEO_EMAIL.toUpperCase()} `,
      name: "Theo",
    });

    expect(invited.ok).toBe(true);
    if (!invited.ok) return;

    // In the fragment, so the token is never sent to a server: not to this
    // one's request log, and not to anybody else's in a Referer header.
    expect(invited.link).toMatch(/\/set-password#[A-Za-z0-9]+$/);

    const [account] = await owner()`
      select u.role, u.person_owner_id, count(a.id)::int as passwords
      from users u left join accounts a on a.user_id = u.id
      where u.email = ${THEO_EMAIL}
      group by u.role, u.person_owner_id
    `;

    // An individual, never anything more: an invite cannot make an admin.
    expect(account).toEqual({ role: "individual", person_owner_id: OWNER.theo, passwords: 0 });
  });

  test("cannot make a second account for somebody who has one", async () => {
    const priya = await signIn("priya@example.invalid");

    const again = await inviteToSignIn(priya, {
      personOwnerId: OWNER.maya,
      email: "maya.again@example.invalid",
      name: "Maya",
    });

    expect(again.ok).toBe(false);
    expect(
      await owner()`select id from users where email = 'maya.again@example.invalid'`,
    ).toHaveLength(0);
  });

  test("cannot take an address somebody else already signs in with", async () => {
    const priya = await signIn("priya@example.invalid");

    const taken = await inviteToSignIn(priya, {
      personOwnerId: OWNER.frank,
      email: "maya@example.invalid",
      name: "Frank",
    });

    expect(taken.ok).toBe(false);
    expect(await owner()`select id from users where person_owner_id = ${OWNER.frank}`)
      .toHaveLength(0);
  });
});

describe("the link", () => {
  test("sets a password once, and the second time is refused", async () => {
    const priya = await signIn("priya@example.invalid");
    const link = await signInLinkFor(priya, OWNER.theo);
    expect(link.ok).toBe(true);
    if (!link.ok) return;

    const token = tokenOf(link.link);

    expect(await setPasswordWithLink(token, "theos-own-long-password")).toEqual({ ok: true });
    await signIn(THEO_EMAIL, "theos-own-long-password");

    const replay = await setPasswordWithLink(token, "somebody-elses-password");
    expect(replay.ok).toBe(false);
    await signIn(THEO_EMAIL, "theos-own-long-password");
  });

  test("refuses a short password without spending the link", async () => {
    const priya = await signIn("priya@example.invalid");
    const link = await signInLinkFor(priya, OWNER.theo);
    if (!link.ok) throw new Error(link.problem);

    const token = tokenOf(link.link);

    expect((await setPasswordWithLink(token, "short")).ok).toBe(false);
    expect(await setPasswordWithLink(token, "a-second-long-password")).toEqual({ ok: true });
  });

  test("a reset signs the account out everywhere", async () => {
    const theo = await signIn(THEO_EMAIL, "a-second-long-password");
    const before = await auth.api.getSession({ headers: theo });
    expect(before?.user.email).toBe(THEO_EMAIL);

    const priya = await signIn("priya@example.invalid");
    const link = await signInLinkFor(priya, OWNER.theo);
    if (!link.ok) throw new Error(link.problem);
    await setPasswordWithLink(tokenOf(link.link), "a-third-long-password");

    // Whoever reset it may be the person who was locked out of a stolen
    // laptop. Leaving the old session alive would leave the thief signed in.
    expect(await auth.api.getSession({ headers: theo })).toBeNull();
  });

  test("an unknown token is refused, not explained", async () => {
    const result = await setPasswordWithLink("not-a-real-token", "a-long-enough-password");
    expect(result.ok).toBe(false);
  });

  test("there is no link for somebody with no account", async () => {
    const priya = await signIn("priya@example.invalid");
    expect((await signInLinkFor(priya, OWNER.frank)).ok).toBe(false);
  });
});
