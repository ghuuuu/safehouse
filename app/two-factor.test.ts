/**
 * Two-factor sign-in (Step 16, D36).
 *
 * The library does the work (better-auth's `twoFactor` plugin: TOTP, backup
 * codes, lockout). These pin down how it is wired here: that turning it on
 * takes the password and a working code, that a password alone then gets no
 * session, that the secret is not stored as itself, and that the vault role
 * never sees any of it.
 */

import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { USER } from "./db/fixture";
import { closeTestDatabase, owner, prepareTestDatabase, refusal, asUser } from "./db/test-harness";

const testUrl = (role: string, password: string) => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = role;
  url.password = password;
  return url.toString();
};

process.env.AUTH_DATABASE_URL = testUrl("safehouse_auth", process.env.AUTH_DB_PASSWORD!);
process.env.APP_DATABASE_URL = testUrl("safehouse_app", process.env.APP_DB_PASSWORD!);

const { auth, listDevices, signOutDevice } = await import("./auth.server");

const PASSWORD = "correct-horse-battery-staple";
const MAYA = "maya@example.invalid";

beforeAll(async () => {
  await prepareTestDatabase();
  const context = await auth.$context;
  const hash = await context.password.hash(PASSWORD);
  await owner()`
    insert into accounts (user_id, issuer, account_id, provider_id, password)
    values (${USER.maya}, 'local:credential', ${USER.maya}, 'credential', ${hash})
  `;
}, 60_000);

afterAll(async () => {
  await owner()`delete from two_factors`;
  await owner()`update users set two_factor_enabled = false`;
  await owner()`delete from sessions`;
  await owner()`delete from accounts`;
  await owner()`delete from verifications`;
  await closeTestDatabase();
});

function post(path: string, body: unknown, headers: Headers | HeadersInit = {}) {
  const h = new Headers(headers);
  h.set("content-type", "application/json");
  return auth.handler(
    new Request(`http://localhost:4021/api/auth${path}`, { method: "POST", headers: h, body: JSON.stringify(body) }),
  );
}

function cookiesOf(response: Response, previous = ""): Headers {
  const jar = new Map(previous.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c] as const));
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0];
    jar.set(pair.split("=")[0], pair);
  }
  return new Headers({ cookie: [...jar.values()].join("; ") });
}

/** RFC 6238, for the test's authenticator. The vault never computes one. */
function totp(base32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function hasSession(headers: Headers) {
  return (await auth.api.getSession({ headers })) !== null;
}

let secret = "";
let backupCodes: string[] = [];

describe("turning it on", () => {
  test("takes the password, and is not on until a code from the app works", async () => {
    const signedIn = await post("/sign-in/email", { email: MAYA, password: PASSWORD });
    const headers = cookiesOf(signedIn);

    const wrong = await post("/two-factor/enable", { password: "not-her-password" }, headers);
    expect(wrong.status).toBe(400);

    const enabled = await post("/two-factor/enable", { password: PASSWORD }, headers);
    expect(enabled.status).toBe(200);
    const body = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
    secret = new URL(body.totpURI).searchParams.get("secret")!;
    backupCodes = body.backupCodes;
    const afterEnable = cookiesOf(enabled, headers.get("cookie")!);

    const [half] = await owner()`select two_factor_enabled from users where id = ${USER.maya}`;
    expect(half.two_factor_enabled).toBe(false);

    const verified = await post("/two-factor/verify-totp", { code: totp(secret) }, afterEnable);
    expect(verified.status, await verified.clone().text()).toBe(200);

    const [on] = await owner()`select two_factor_enabled from users where id = ${USER.maya}`;
    expect(on.two_factor_enabled).toBe(true);
  });

  test("the secret is not stored as itself, and the vault role cannot read it", async () => {
    const [row] = await owner()`select secret, backup_codes from two_factors where user_id = ${USER.maya}`;
    expect(row.secret).not.toContain(secret);
    expect(row.backup_codes).not.toContain(backupCodes[0]);

    const error = await refusal(() => asUser(USER.priya, (sql) => sql`select * from two_factors`));
    expect(error?.code).toBe("42501");
  });
});

describe("signing in with it on", () => {
  test("a password alone gets no session, only the chance to give a code", async () => {
    const response = await post("/sign-in/email", { email: MAYA, password: PASSWORD });
    expect(((await response.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    expect(await hasSession(cookiesOf(response))).toBe(false);
  });

  test("a wrong code gets nothing; the right one gets a session", async () => {
    const pending = cookiesOf(await post("/sign-in/email", { email: MAYA, password: PASSWORD }));

    const wrong = await post("/two-factor/verify-totp", { code: "000000" === totp(secret) ? "111111" : "000000" }, pending);
    expect(wrong.ok).toBe(false);

    const right = await post("/two-factor/verify-totp", { code: totp(secret) }, pending);
    expect(right.status).toBe(200);
    expect(await hasSession(cookiesOf(right, pending.get("cookie")!))).toBe(true);
  });

  test("a code without the password step first gets nothing", async () => {
    const response = await post("/two-factor/verify-totp", { code: totp(secret) });
    expect(response.ok).toBe(false);
  });

  test("a backup code works once", async () => {
    const first = cookiesOf(await post("/sign-in/email", { email: MAYA, password: PASSWORD }));
    const used = await post("/two-factor/verify-backup-code", { code: backupCodes[0] }, first);
    expect(used.status).toBe(200);

    const second = cookiesOf(await post("/sign-in/email", { email: MAYA, password: PASSWORD }));
    const again = await post("/two-factor/verify-backup-code", { code: backupCodes[0] }, second);
    expect(again.ok).toBe(false);
  });
});

describe("turning it off", () => {
  test("takes the password, and then a password is enough again", async () => {
    const pending = cookiesOf(await post("/sign-in/email", { email: MAYA, password: PASSWORD }));
    const signedIn = cookiesOf(await post("/two-factor/verify-totp", { code: totp(secret) }, pending), pending.get("cookie")!);

    const off = await post("/two-factor/disable", { password: PASSWORD }, signedIn);
    expect(off.status).toBe(200);

    const plain = await post("/sign-in/email", { email: MAYA, password: PASSWORD });
    expect(await hasSession(cookiesOf(plain))).toBe(true);
  });
});

describe("signed-in devices", () => {
  test("lists only the caller's own sessions, and never a token", async () => {
    const here = cookiesOf(await post("/sign-in/email", { email: MAYA, password: PASSWORD }));
    await post("/sign-in/email", { email: MAYA, password: PASSWORD });

    const devices = await listDevices(here);
    const tokens = await owner()`select token, user_id from sessions`;

    expect(devices.filter((d) => d.current)).toHaveLength(1);
    expect(devices.length).toBe(tokens.filter((t) => t.user_id === USER.maya).length);
    const payload = JSON.stringify(devices);
    expect(tokens.some((t) => payload.includes(t.token as string))).toBe(false);
  });

  test("signs out one of the caller's devices, and nobody else's", async () => {
    const here = cookiesOf(await post("/sign-in/email", { email: MAYA, password: PASSWORD }));
    const other = (await listDevices(here)).find((d) => !d.current)!;

    const [stranger] = await owner()`
      insert into sessions (user_id, token, expires_at) values (${USER.priya}, 'not-mayas', now() + interval '1 day')
      returning id
    `;

    expect(await signOutDevice(here, stranger.id as string)).toBe(false);
    expect(await owner()`select 1 from sessions where id = ${stranger.id}`).toHaveLength(1);

    expect(await signOutDevice(here, other.id)).toBe(true);
    expect(await owner()`select 1 from sessions where id = ${other.id}`).toHaveLength(0);
    expect(await hasSession(here)).toBe(true);
  });
});
