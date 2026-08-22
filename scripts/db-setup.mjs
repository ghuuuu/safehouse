/**
 * Creates the restricted database role the application signs in as.
 *
 * Two roles, deliberately (D11):
 *
 *   safehouse      — owns the tables, runs migrations. Bypasses row-level
 *                    security, because it has to in order to create it.
 *   safehouse_app  — what the running application connects as. Owns nothing,
 *                    so every policy applies to it. If a request forgets to say
 *                    who it is for, `current_app_user()` is null, no policy
 *                    matches, and every query returns nothing.
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

if (!url) {
  console.error("Missing DATABASE_URL. See .env.example.");
  process.exit(1);
}

if (!password) {
  console.error("Missing APP_DB_PASSWORD. See .env.example.");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  const database = sql.options.database;

  await sql`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'safehouse_app') then
        create role safehouse_app login;
      end if;
    end
    $$;
  `;

  // A password cannot be a bound parameter in ALTER ROLE, so it is quoted by
  // hand. Doubling any single quote is the whole escape rule for a SQL literal.
  const quoted = `'${password.replace(/'/g, "''")}'`;

  await sql.unsafe(
    `alter role safehouse_app with login nosuperuser nocreatedb nocreaterole ` +
      `nobypassrls password ${quoted}`,
  );

  await sql.unsafe(`grant connect on database "${database}" to safehouse_app`);
  await sql`grant usage on schema public to safehouse_app`;

  console.log(`safehouse_app is ready on database "${database}".`);
} finally {
  await sql.end();
}
