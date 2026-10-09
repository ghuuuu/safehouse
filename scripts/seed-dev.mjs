/**
 * Fills an empty development database with the fixture household, and gives one
 * account per role a password (`app/dev-logins.server.ts`, which the sign-in
 * page's development buttons use too).
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
import postgres from "postgres";

import { insertFixture } from "../app/db/fixture.ts";
import { DEV_LOGINS, DEV_PASSWORD, writeDevLogins } from "../app/dev-logins.server.ts";
import { keys } from "../app/keys.server.ts";

/** `--logins`: only (re)write the sign-ins, on a vault seeded before they grew. */
const loginsOnly = process.argv.includes("--logins");

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

  if (loginsOnly) {
    const done = await writeDevLogins(sql);
    if (done.length === 0) fail("No fixture accounts here, so nobody to give a sign-in to.");
    console.log(`Sign-ins written, password ${DEV_PASSWORD}:`);
    for (const email of done) console.log(`  ${email}`);
    process.exit(0);
  }

  if (existing[0].n > 0) {
    fail(
      `This database already has ${existing[0].n} account(s). Refusing to seed on top of them.`,
      "Start over with: docker compose down -v && docker compose up -d db && npm run db:migrate",
    );
  }

  // Under this machine's own key, so the dev server can reveal what it seeded
  // (D35). The test database uses the fixture key instead.
  await insertFixture(sql, keys());

  // better-auth's own scrypt, inside writeDevLogins, so the hash is one its
  // sign-in can verify. Hashing is never hand-rolled here (CLAUDE.md).
  await writeDevLogins(sql);

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
  console.log(`\nSign in at ${signIn} with the password ${DEV_PASSWORD}, or with the buttons beside the form:`);
  for (const login of DEV_LOGINS) {
    console.log(`  ${login.email.padEnd(24)} ${login.role}, ${login.note}`);
  }
  console.log("\n/setup is closed from now on: this vault has accounts.");
} finally {
  await sql.end();
}
