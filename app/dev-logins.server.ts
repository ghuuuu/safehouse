/**
 * One-click sign-ins for development: one fictional account per role, all with
 * the seed's password, so trying the app as somebody else is a click rather
 * than a lookup.
 *
 * Off unless both are true: the server is the Vite dev server
 * (`import.meta.env.DEV`, false in every production build, where this code is
 * dropped), and the database is on this machine. The buttons send only which
 * account; the password is added here, on the server, and the sign-in itself
 * is better-auth's own, rate limits and two-factor included. Nothing here
 * hands out a session.
 *
 * Only `@example.invalid` accounts, which only the fixture creates, so a real
 * vault on this machine has nobody these could sign in as.
 */

import { hashPassword } from "better-auth/crypto";
import type postgres from "postgres";

/** Not a secret, and not meant to look like one: fictional accounts on one machine. */
export const DEV_PASSWORD = "safehouse-dev-password";

export const DEV_LOGINS = [
  { email: "priya@example.invalid", name: "Priya Raman", role: "Administrator", note: "sees everything, runs Access" },
  { email: "maya@example.invalid", name: "Maya Adeyemi", role: "Household member", note: "her circle of the family" },
  { email: "sam@example.invalid", name: "Sam Okafor", role: "Third party", note: "the accountant: the business, and one will" },
  { email: "medic@example.invalid", name: "Emergency Contact", role: "Emergency contact", note: "with an emergency window open" },
  { email: "lapsed@example.invalid", name: "Lapsed Contact", role: "Emergency contact", note: "no window yet: can open one" },
] as const;

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function devLoginsEnabled(
  databaseUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL,
  dev: boolean = import.meta.env.DEV,
): boolean {
  if (!dev || !databaseUrl) return false;
  try {
    return LOCAL.has(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

/** The account a button asked for, or null when it is not one of the list. */
export function devLoginFor(email: string) {
  return DEV_LOGINS.find((login) => login.email === email) ?? null;
}

/**
 * What a sign-in form's development button asks for, as the credentials to
 * sign in with: null when the form has no button press, `false` when it named
 * an account that is not on the list or the buttons are off. Call it behind
 * `import.meta.env.DEV`, so a production build drops this module entirely.
 */
export function devCredentials(form: FormData): { email: string; password: string } | false | null {
  const asked = form.get("dev-login");
  if (asked === null) return null;
  const login = typeof asked === "string" && devLoginsEnabled() ? devLoginFor(asked) : null;
  return login ? { email: login.email, password: DEV_PASSWORD } : false;
}

/**
 * Gives each listed account a password credential with the dev password,
 * replacing any it had. For the seed, and for `npm run dev:logins` on a vault
 * seeded before this list grew. Touches only `@example.invalid` users.
 */
export async function writeDevLogins(sql: postgres.Sql): Promise<string[]> {
  const password = await hashPassword(DEV_PASSWORD);
  const done: string[] = [];
  for (const login of DEV_LOGINS) {
    const [user] = await sql`
      select id from users where email = ${login.email} and email like '%@example.invalid'
    `;
    if (!user) continue;
    await sql`delete from accounts where user_id = ${user.id} and provider_id = 'credential'`;
    await sql`
      insert into accounts (user_id, issuer, account_id, provider_id, password)
      values (${user.id}, 'local:credential', ${user.id}, 'credential', ${password})
    `;
    done.push(login.email);
  }
  return done;
}
