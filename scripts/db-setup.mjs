/**
 * Creates the restricted database role the application signs in as.
 *
 * Two roles, deliberately (D11):
 *
 *   safehouse      — owns the tables, runs migrations. Bypasses row-level
 *                    security, because it has to in order to create it.
 *   safehouse_app  — what the running application connects as to read the
 *                    vault. Owns nothing, so every policy applies to it. If a
 *                    request forgets to say who it is for, `current_app_user()`
 *                    is null, no policy matches, and every query returns
 *                    nothing.
 *   safehouse_auth — what the sign-in code connects as. It can read and write
 *                    accounts, sessions and users, because checking a password
 *                    requires that. It has no privileges at all on records,
 *                    documents or files, so the half of the application that
 *                    handles credentials cannot read a single document (D24).
 *
 * That last sentence is the reason for the whole arrangement. The failure mode
 * of a mistake here is a blank page, not somebody else's passport.
 *
 * Idempotent. Run it before migrating; `npm run db:migrate` does.
 */

import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const password = process.env.APP_DB_PASSWORD;
const authPassword = process.env.AUTH_DB_PASSWORD;

if (!url) {
  console.error("Missing DATABASE_URL. See .env.example.");
  process.exit(1);
}

if (!password) {
  console.error("Missing APP_DB_PASSWORD. See .env.example.");
  process.exit(1);
}

if (!authPassword) {
  console.error("Missing AUTH_DB_PASSWORD. See .env.example.");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  const database = sql.options.database;

  // A password cannot be a bound parameter in ALTER ROLE, so it is quoted by
  // hand. Doubling any single quote is the whole escape rule for a SQL literal.
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;

  for (const [role, secret] of [
    ["safehouse_app", password],
    ["safehouse_auth", authPassword],
  ]) {
    await sql.unsafe(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = '${role}') then
          create role ${role} login;
        end if;
      end
      $$;
    `);

    // Set every run, so rotating a password is one edit to .env and one command.
    await sql.unsafe(
      `alter role ${role} with login nosuperuser nocreatedb nocreaterole ` +
        `nobypassrls password ${quote(secret)}`,
    );

    await sql.unsafe(`grant connect on database "${database}" to ${role}`);
    // `public` only. The `perm` schema holds the permission rules themselves,
    // and neither of these roles may reach it (D25) — a policy gets there
    // through a security definer function instead. Adding it here would undo
    // that in one line, and this is the obvious place somebody would try.
    await sql.unsafe(`grant usage on schema public to ${role}`);
  }

  console.log(
    `safehouse_app and safehouse_auth are ready on database "${database}".`,
  );
} finally {
  await sql.end();
}
