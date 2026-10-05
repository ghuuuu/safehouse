/**
 * Fills an empty development database with the fixture household, and gives two
 * of its accounts a password.
 *
 * Both halves, deliberately. Seeding closes `/setup` — the first-run page is
 * open only while the vault has no accounts at all (`noUsersYet` in
 * auth.server.ts) — so a fixture-seeded database with no credential row has no
 * way in: no sign-in, and no page left that would create one. That trap is the
 * reason this script exists.
 *
 * Development only. It refuses a database that is not on this machine, and
 * refuses one that already has accounts rather than seeding a second household
 * on top of the first. The fixture is fictional (CLAUDE.md); a real vault
 * seeded with it would still be a real mess.
 */

import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";

import { insertFixture, USER } from "../app/db/fixture.ts";

/**
 * Not a secret, and not meant to look like one: fictional accounts, in a
 * database that exists on one developer's machine.
 */
const PASSWORD = "safehouse-dev-password";

/** Two accounts, because one of each is what the permission work needs to see. */
const SIGN_INS = [
  [USER.priya, "priya@example.invalid", "household administrator"],
  [USER.maya, "maya@example.invalid", "ordinary family member"],
];

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function fail(...lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

const url = process.env.DATABASE_URL;

if (!url) fail("Missing DATABASE_URL. See .env.example.");

const { hostname } = new URL(url);

if (!LOCAL.has(hostname)) {
  fail(
    `Refusing to seed "${hostname}". This script only runs against a database on this machine.`,
  );
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const existing = await sql`select count(*)::int as n from users`.catch(
    (error) =>
      error.code === "42P01"
        ? fail(
            "This database has no tables yet.",
            "Run `npm run db:migrate` first — the app container cannot migrate itself (D22).",
          )
        : Promise.reject(error),
  );

  if (existing[0].n > 0) {
    fail(
      `This database already has ${existing[0].n} account(s). Refusing to seed on top of them.`,
      "Start over with: docker compose down -v && docker compose up -d db && npm run db:migrate",
    );
  }

  await insertFixture(sql);

  // better-auth's own scrypt, so the hash is one its sign-in can verify.
  // Hashing is never hand-rolled here (CLAUDE.md).
  const password = await hashPassword(PASSWORD);

  for (const [userId] of SIGN_INS) {
    await sql`
      insert into accounts (user_id, issuer, account_id, provider_id, password)
      values (${userId}, 'local:credential', ${userId}, 'credential', ${password})
    `;
  }

  const [counts] = await sql`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from owners) as owners,
      (select count(*)::int from documents) as documents
  `;

  const signIn = `${process.env.BETTER_AUTH_URL ?? "http://localhost:4021"}/sign-in`;

  console.log(
    `Seeded the fixture household: ${counts.owners} owners, ${counts.users} accounts, ${counts.documents} documents.`,
  );
  console.log(`\nSign in at ${signIn} with the password ${PASSWORD}:`);
  for (const [, email, who] of SIGN_INS) {
    console.log(`  ${email.padEnd(24)} ${who}`);
  }
  console.log("\n/setup is closed from now on: this vault has accounts.");
} finally {
  await sql.end();
}
