/**
 * Test database plumbing.
 *
 * Every permission test runs against real Postgres, as the real restricted
 * role, through the real policies. A permission rule that is only tested
 * against a mock is a permission rule that has never been tested.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { requireEnv } from "../config.server";
import { insertFixture } from "./fixture";

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

const TEST_DATABASE = process.env.TEST_DATABASE_NAME ?? "safehouse_test";

let ownerSql: postgres.Sql | undefined;
let appSql: postgres.Sql | undefined;
let authSql: postgres.Sql | undefined;
let prepared: Promise<void> | undefined;

/**
 * Opens this worker's connections. Cheap, and safe to call from every test
 * file: the database itself is built once per run by `buildTestDatabase`,
 * which vitest calls before any test file loads.
 */
export function prepareTestDatabase(): Promise<void> {
  prepared ??= connect();
  return prepared;
}

async function connect(): Promise<void> {
  const ownerUrl = requireEnv("DATABASE_URL");
  ownerSql = postgres(withDatabase(ownerUrl, TEST_DATABASE), {
    max: 1,
    onnotice: () => {},
  });
  appSql = connectAs(ownerUrl, "safehouse_app", requireEnv("APP_DB_PASSWORD"));
  authSql = connectAs(ownerUrl, "safehouse_auth", requireEnv("AUTH_DB_PASSWORD"));
}

/**
 * Rebuilds the test database from the migrations and the fixture, from nothing.
 * Dropping the schema first means a migration that only works on an empty
 * database still gets caught here.
 *
 * Runs once per `npm test`, before any test file — test files run in separate
 * workers, and two of them rebuilding the same database at once is a race.
 */
export async function buildTestDatabase(): Promise<void> {
  const ownerUrl = requireEnv("DATABASE_URL");
  const maintenance = postgres(withDatabase(ownerUrl, "postgres"), { max: 1 });

  try {
    const existing = await maintenance`
      select 1 from pg_database where datname = ${TEST_DATABASE}
    `;

    if (existing.length === 0) {
      await maintenance.unsafe(`create database "${TEST_DATABASE}"`);
    }
  } finally {
    await maintenance.end();
  }

  const testUrl = withDatabase(ownerUrl, TEST_DATABASE);
  ownerSql = postgres(testUrl, { max: 1, onnotice: () => {} });

  await ownerSql.unsafe(`
    drop schema if exists drizzle cascade;
    drop schema if exists public cascade;
    create schema public;
    grant connect on database "${TEST_DATABASE}" to safehouse_app;
    grant connect on database "${TEST_DATABASE}" to safehouse_auth;
    -- A hand-made public schema does not carry the default grants a fresh
    -- database's does, so the restricted roles need saying to explicitly.
    grant usage on schema public to safehouse_app;
    grant usage on schema public to safehouse_auth;
  `);

  await migrate(drizzle(ownerSql), { migrationsFolder: "drizzle" });
  await insertFixture(ownerSql);

  await ownerSql.end();
  ownerSql = undefined;
}

function connectAs(
  ownerUrl: string,
  role: string,
  password: string,
): postgres.Sql {
  const url = new URL(withDatabase(ownerUrl, TEST_DATABASE));
  url.username = role;
  url.password = password;
  return postgres(url.toString(), { max: 1, onnotice: () => {} });
}

export async function closeTestDatabase(): Promise<void> {
  await Promise.all([ownerSql?.end(), appSql?.end(), authSql?.end()]);
  ownerSql = undefined;
  appSql = undefined;
  authSql = undefined;
  prepared = undefined;
}

/** The owner connection. Setup only — it bypasses every policy. */
export function owner(): postgres.Sql {
  if (!ownerSql) throw new Error("prepareTestDatabase() has not run");
  return ownerSql;
}

/**
 * Runs a query the way a request will: as the restricted role, inside one
 * transaction, having said who is asking. Pass null to say nobody is asking —
 * which is exactly what a bug that forgets to set the user looks like.
 */
export async function asUser<T>(
  userId: string | null,
  query: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  if (!appSql) throw new Error("prepareTestDatabase() has not run");

  return appSql.begin(async (tx) => {
    await tx`select set_config('safehouse.user_id', ${userId ?? ""}, true)`;
    return query(tx as unknown as postgres.Sql);
  }) as Promise<T>;
}

/**
 * A transaction that never says who is asking at all — the shape of a request
 * that skipped the helper entirely, on a pooled connection that has already
 * served somebody else.
 */
export async function asNobody<T>(
  query: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  if (!appSql) throw new Error("prepareTestDatabase() has not run");

  return appSql.begin((tx) =>
    query(tx as unknown as postgres.Sql),
  ) as Promise<T>;
}

/**
 * The connection the sign-in code uses. It can reach users, sessions, accounts
 * and verifications, and nothing else — the tests in identity.test.ts are what
 * keep that true.
 */
export async function asAuthRole<T>(
  query: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  if (!authSql) throw new Error("prepareTestDatabase() has not run");

  return authSql.begin((tx) =>
    query(tx as unknown as postgres.Sql),
  ) as Promise<T>;
}
