import { AsyncLocalStorage } from "node:async_hooks";

import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { and, count, eq, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { requireEnv } from "./config.server";
import * as schema from "./db/schema";
import { forgetTries, spendTry, TOO_MANY_TRIES } from "./tries.server";

/**
 * Sign-in, sessions and passwords (D10).
 *
 * This module is the only thing that connects as `safehouse_auth`, a role with
 * no privileges at all on records, documents or files (D24). It can read a
 * password hash; it cannot read a will. Everything the vault serves goes
 * through `asUser` in db.server.ts instead, on the other connection.
 *
 * Nothing here is hand-rolled: the library owns password hashing, session
 * tokens and cookie signing, because those are exactly the things that look
 * simple and are not.
 */

/** The setup page's floor, and since invites, everybody's. */
export const MIN_PASSWORD = 12;

/**
 * How long an invite or reset link stays good. Delivered by hand (D13), so it
 * has to survive a weekend; single-use, so it does not have to survive longer.
 */
const LINK_LIFETIME_SECONDS = 72 * 60 * 60;

let cached: postgres.Sql | undefined;

function authClient(): postgres.Sql {
  cached ??= postgres(requireEnv("AUTH_DATABASE_URL"), { max: 5 });
  return cached;
}

function authDb() {
  return drizzle(authClient());
}

/** True when the vault has no accounts at all — the state a fresh install is in. */
export async function noUsersYet(): Promise<boolean> {
  const [row] = await authDb().select({ n: count() }).from(schema.users);
  return (row?.n ?? 0) === 0;
}

/**
 * Check a password without issuing a session.
 *
 * For step-up: downloading a file re-asks for the password of the account
 * already signed in, so a borrowed laptop with a live session cannot pull
 * documents out of the vault. Signing in again would work too and would also
 * mint a second session, which is a worse answer to "prove it is still you".
 *
 * The hash is read over the auth connection, the only one that can see it
 * (D24), and compared by the library rather than by anything here.
 */
export async function passwordMatches(
  userId: string,
  password: string,
): Promise<"match" | "wrong" | "locked"> {
  // The same count as the library's own password endpoints (`triesKey`), so
  // a stolen session cannot guess here and there by turns.
  const key = `user:${userId}`;
  if (!spendTry(key)) return "locked";

  const [account] = await authDb()
    .select({ password: schema.accounts.password })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.userId, userId),
        eq(schema.accounts.providerId, "credential"),
      ),
    );

  if (!account?.password) return "wrong";

  const context = await auth.$context;
  if (!(await context.password.verify({ hash: account.password, password }))) return "wrong";
  forgetTries(key);
  return "match";
}

/**
 * A direct library call, with the count of tries' refusal as `null`. Called
 * directly, the library throws a hook's refusal rather than answering with it,
 * and the only refusal a password-taking call can meet is that one. Saying so
 * gives nothing away: an unknown address is counted the same as a real one.
 */
export function unlessLocked(call: Promise<Response>): Promise<Response | null> {
  return call.catch((error: unknown) => {
    if (isAPIError(error) && error.statusCode === 429) return null;
    throw error;
  });
}

/**
 * Whose count a library request spends a try from, when it carries a
 * password: the address signing in, or the signed-in account proving itself
 * (change-password, two-factor on and off, verify-password). Sign-up's
 * password is a new one, not a proof, and spends nothing.
 */
async function triesKey(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]): Promise<string | null> {
  const body = ctx.body as { email?: unknown; password?: unknown; currentPassword?: unknown } | undefined;
  if (ctx.path === "/sign-in/email") return `email:${String(body?.email ?? "").trim().toLowerCase()}`;
  if (ctx.path === "/sign-up/email" || (body?.password === undefined && body?.currentPassword === undefined)) return null;
  const session = await getSessionFromCtx(ctx);
  return session ? `user:${session.user.id}` : null;
}

/**
 * True for a session that belongs to an admin who has not been disabled.
 *
 * Disabled is checked here because nothing else on this side checks it. The
 * library still honours a disabled account's session; `getSignedInUser` is what
 * treats it as signed out, and the gates below run before that.
 */
function isActiveAdmin(user: unknown): boolean {
  const u = user as { role?: string | null; disabledAt?: unknown } | undefined;
  return u?.role === "admin" && !u.disabledAt;
}

/** A request that only an admin may make, made by somebody else. */
export class NotAllowed extends Error {}

export type LinkResult =
  | { ok: true; link: string }
  /** Something the admin can fix, said in their words. */
  | { ok: false; problem: string };

/**
 * Where the library hands over a reset token: to whichever `signInLinkFor`
 * call asked for it, and to nobody else.
 *
 * This is the delivery slot D13 describes. Today the only channel is the admin's
 * screen; email, when it exists, is a second thing to do with the same token.
 */
const delivery = new AsyncLocalStorage<(token: string) => void>();

async function requireAdmin(headers: Headers): Promise<void> {
  const session = await auth.api.getSession({ headers });
  if (!isActiveAdmin(session?.user)) throw new NotAllowed();
}

/**
 * A link that sets the password of the account on this person, once.
 *
 * The token is in the fragment, so the browser never sends it anywhere: not in
 * the server's request log, and not in a Referer header. The
 * page reads it out and posts it.
 */
export async function signInLinkFor(
  headers: Headers,
  personOwnerId: string,
): Promise<LinkResult> {
  await requireAdmin(headers);

  const [user] = await authDb()
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.personOwnerId, personOwnerId));

  if (!user) {
    return { ok: false, problem: "They have no sign-in yet. Invite them instead." };
  }

  let token: string | undefined;
  await delivery.run(
    (delivered) => {
      token = delivered;
    },
    () => auth.api.requestPasswordReset({ body: { email: user.email }, headers }),
  );

  if (!token) throw new Error("The reset token was never delivered.");

  return { ok: true, link: `${requireEnv("BETTER_AUTH_URL")}/set-password#${token}` };
}

/**
 * Give a person in the tree a sign-in: an account with no password, attached
 * to them, and the link that sets one.
 *
 * Always an individual. Admin is made once, at first run, and a third party or
 * an emergency contact has no person to attach to, so neither comes through
 * here. The account is made by the library's own adapter rather than its
 * sign-up endpoint, because sign-up insists on a password and would sign the
 * new account in on the admin's request.
 */
export async function inviteToSignIn(
  headers: Headers,
  invite: { personOwnerId: string; email: string; name: string },
): Promise<LinkResult> {
  await requireAdmin(headers);

  const email = invite.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, problem: "That does not look like an email address." };
  }

  const [taken] = await authDb()
    .select({ email: schema.users.email, person: schema.users.personOwnerId })
    .from(schema.users)
    .where(or(eq(schema.users.email, email), eq(schema.users.personOwnerId, invite.personOwnerId)));

  if (taken) {
    return {
      ok: false,
      problem:
        taken.person === invite.personOwnerId
          ? "They already have a sign-in. Make them a new link instead."
          : "Somebody already signs in with that address.",
    };
  }

  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({
    email,
    name: invite.name,
    emailVerified: false,
    role: "individual",
    personOwnerId: invite.personOwnerId,
  }, { method: "admin" });

  try {
    const link = await signInLinkFor(headers, invite.personOwnerId);
    if (!link.ok) throw new Error(link.problem);
    return link;
  } catch (error) {
    // An account with no password and no link is a person nobody can let in.
    await context.internalAdapter.deleteUser(user.id);
    throw error;
  }
}

/** Spend a link. A bad token and a used one get the same answer. */
export async function setPasswordWithLink(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (newPassword.length < MIN_PASSWORD) {
    // The library enforces the same floor, also before it spends the token.
    // Checked here as well only so the answer is a sentence, not an error code.
    return { ok: false, problem: `Use at least ${MIN_PASSWORD} characters.` };
  }

  try {
    await auth.api.resetPassword({ body: { token, newPassword } });
    return { ok: true };
  } catch {
    return {
      ok: false,
      problem: "This link has been used or has expired. Ask for a new one.",
    };
  }
}

/**
 * Who the delivery sweep works on behalf of: every active admin.
 *
 * Read over the auth connection because the sweep runs with nobody signed in,
 * and `users_read` would give a nameless transaction nothing. Ids only.
 */
export async function activeAdminIds(): Promise<string[]> {
  const rows = await authDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.role, "admin"), isNull(schema.users.disabledAt)));
  return rows.map((row) => row.id);
}

/** One signed-in device, as the settings page shows it. Never the token. */
export type Device = {
  id: string;
  /** The browser's own description of itself, shortened. */
  device: string;
  ipAddress: string | null;
  signedInAt: Date;
  lastSeenAt: Date;
  current: boolean;
};

/**
 * The signed-in account's own sessions.
 *
 * Read over the auth connection, the only one that can see `sessions` (D24),
 * and only the caller's rows. A session token is a password with a time
 * limit, so it never leaves this module; the page gets ids.
 */
export async function listDevices(headers: Headers): Promise<Device[]> {
  const session = await auth.api.getSession({ headers });
  if (!session) return [];

  const rows = await authDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, session.user.id));

  return rows
    .map((row) => ({
      id: row.id,
      device: describeDevice(row.userAgent),
      ipAddress: row.ipAddress,
      signedInAt: row.createdAt,
      lastSeenAt: row.updatedAt,
      current: row.id === session.session.id,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || +b.lastSeenAt - +a.lastSeenAt);
}

/** Sign out one of the caller's own devices, by id. Somebody else's id is no row. */
export async function signOutDevice(headers: Headers, sessionId: string): Promise<boolean> {
  const session = await auth.api.getSession({ headers });
  if (!session) return false;

  const [row] = await authDb()
    .select({ token: schema.sessions.token })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, session.user.id)));
  if (!row) return false;

  await auth.api.revokeSession({ headers, body: { token: row.token } });
  return true;
}

/** "Firefox on Windows", from a user agent, without a parsing library. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  // Order matters: Edge says Chrome too, and Chrome says Safari.
  const pick = (pairs: [RegExp, string][]) => pairs.find(([pattern]) => pattern.test(userAgent))?.[1];
  const name = pick([[/Edg\//, "Edge"], [/Firefox\//, "Firefox"], [/Chrome\//, "Chrome"], [/Safari\//, "Safari"]]) ?? "A browser";
  const os = pick([[/Windows/, "Windows"], [/iPhone|iPad/, "iOS"], [/Android/, "Android"], [/Mac OS X/, "macOS"], [/Linux/, "Linux"]]);
  return os ? `${name} on ${os}` : name;
}

export const auth = betterAuth({
  secret: requireEnv("BETTER_AUTH_SECRET"),
  baseURL: requireEnv("BETTER_AUTH_URL"),
  basePath: "/api/auth",

  database: drizzleAdapter(authDb(), {
    provider: "pg",
    // Singular model names, mapped by hand onto the plural tables in
    // db/schema.ts, so a rename on either side fails to compile rather than
    // silently writing to nothing.
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      twoFactor: schema.twoFactors,
    },
  }),

  advanced: {
    database: {
      // Postgres generates the uuid, matching every other table's primary key.
      generateId: false,
    },
  },

  // No usage data leaves this machine. A document vault phones nobody.
  telemetry: { enabled: false },

  // A second factor, from the library (D36): TOTP from an authenticator app,
  // ten single-use backup codes, and its own lockout after repeated wrong
  // codes. Turning it on needs the password and a working code, so a stolen
  // session cannot quietly enrol an attacker's phone. Secrets are encrypted by
  // the library before they reach `two_factors`, which only this role can read.
  plugins: [twoFactor({ issuer: "SafeHouse" })],

  emailAndPassword: {
    enabled: true,
    // Nothing is emailed yet (D8). The admin hands over a link instead.
    requireEmailVerification: false,
    minPasswordLength: MIN_PASSWORD,
    resetPasswordTokenExpiresIn: LINK_LIFETIME_SECONDS,
    // A reset is often how somebody locks a lost laptop out. Leaving its
    // session alive would leave whoever has it signed in.
    revokeSessionsOnPasswordReset: true,
    // Delivers to the `signInLinkFor` call that asked, or refuses. Never logs:
    // the token is a password until it is spent.
    sendResetPassword: async ({ token }) => {
      const deliver = delivery.getStore();
      if (!deliver) throw new Error("There is nowhere to deliver a sign-in link.");
      deliver(token);
    },
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * The first account ever created is the administrator.
         *
         * It has to be decided here rather than taken from the form, because
         * `role` is `input: false` — a sign-up request cannot name its own role
         * and must not be able to. "First" is a fact about the database, so the
         * database is what answers it, and it can only be true once.
         */
        before: async (user) => {
          if (!(await noUsersYet())) return;
          return { data: { ...user, role: "admin" } };
        },
      },
    },
  },

  hooks: {
    /**
     * Who is allowed to create an account.
     *
     * The library exposes sign-up as a public endpoint. For a household vault
     * that is the wrong default by a wide margin: a stranger who signs up is a
     * user, and a user is inside the building. So the endpoint answers only
     * twice — on a fresh install, to make the first admin, and afterwards when
     * an admin is the one asking.
     *
     * This is a lock on the door, not the only lock. A stranger who somehow got
     * an account would still see nothing, because an account with no person
     * attached to it reaches no owner (0003_identity_boundary.sql).
     */
    before: createAuthMiddleware(async (ctx) => {
      // Five tries per account per quarter hour (tries.server.ts). Here
      // rather than in the library's rate limiter, which keys on an address
      // a client can name for itself and runs only for requests over HTTP —
      // not for the sign-in page's direct call.
      const tries = await triesKey(ctx);
      if (tries && !spendTry(tries)) throw new APIError("TOO_MANY_REQUESTS", { message: TOO_MANY_TRIES });

      if (ctx.path === "/sign-up/email") {
        if (await noUsersYet()) return;
        if (isActiveAdmin((await getSessionFromCtx(ctx))?.user)) return;

        throw new APIError("FORBIDDEN", {
          message: "Accounts are created by the household administrator.",
        });
      }

      // The same door from the other side. As shipped, anybody may ask for a
      // reset link for any address; here only the admin may, and only through
      // `signInLinkFor`, which is the one place that can receive the token.
      // Spending a link (`/reset-password`) stays open: holding it is the proof.
      if (ctx.path === "/request-password-reset") {
        if (isActiveAdmin((await getSessionFromCtx(ctx))?.user)) return;

        throw new APIError("FORBIDDEN", {
          message: "Sign-in links are made by the household administrator.",
        });
      }
    }),

    // The right password starts the count again.
    after: createAuthMiddleware(async (ctx) => {
      const tries = await triesKey(ctx);
      if (tries && !isAPIError(ctx.context.returned)) forgetTries(tries);
    }),
  },

  user: {
    additionalFields: {
      // Safehouse owns these three, and `input: false` means the library will
      // not take them from a request body. Without it, the sign-up form could
      // name its own role, which is the whole vault in one POST.
      role: { type: "string", required: false, input: false },
      personOwnerId: { type: "string", required: false, input: false },
      disabledAt: { type: "date", required: false, input: false },
    },
  },
});
