import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { requireEnv } from "./config.server";
import * as schema from "./db/schema";

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

let cached: postgres.Sql | undefined;

function authClient(): postgres.Sql {
  cached ??= postgres(requireEnv("AUTH_DATABASE_URL"), { max: 5 });
  return cached;
}

function authDb() {
  return drizzle(authClient());
}

/** True when the vault has no accounts at all — the state a fresh install is in. */
async function noUsersYet(): Promise<boolean> {
  const [row] = await authDb().select({ n: count() }).from(schema.users);
  return (row?.n ?? 0) === 0;
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

  emailAndPassword: {
    enabled: true,
    // Nothing is emailed yet (D8), so there is no reset link to send. Until
    // there is, the admin resets a password.
    requireEmailVerification: false,
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
      if (ctx.path !== "/sign-up/email") return;

      if (await noUsersYet()) return;

      const session = await getSessionFromCtx(ctx);
      if (session?.user && (session.user as { role?: string }).role === "admin") {
        return;
      }

      throw new APIError("FORBIDDEN", {
        message: "Accounts are created by the household administrator.",
      });
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
