import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { requireEnv } from "./config.server";

let cached: postgres.Sql | undefined;

/**
 * The connection the application uses.
 *
 * `APP_DATABASE_URL` is the restricted role: it owns nothing, so every
 * row-level security policy applies to it (D11). The owner connection, which
 * bypasses those policies, is only ever used by migrations and by scripts run
 * by hand — it is not even present in the app container.
 *
 * Created on first use, so importing this module does not require a live
 * database.
 */
function client(): postgres.Sql {
  cached ??= postgres(requireEnv("APP_DATABASE_URL"), { max: 10 });
  return cached;
}

export function getDb(): PostgresJsDatabase {
  return drizzle(client());
}

/**
 * A transaction that has said who is asking. The type comes from drizzle rather
 * than being written out, so it cannot drift from what `transaction` hands over.
 */
export type VaultTransaction = Parameters<
  Parameters<PostgresJsDatabase["transaction"]>[0]
>[0];

/**
 * Runs everything inside one transaction, on behalf of one signed-in user.
 *
 * This is how a request tells the database who is asking. Nothing outside this
 * function should query the vault, because a query made without it has no user
 * set, matches no policy, and comes back empty — which is the failure this
 * whole arrangement exists to produce. An empty page is recoverable; the other
 * kind of mistake is not.
 *
 * The setting is transaction-scoped (the `true` argument), so it cannot leak
 * into the next request to borrow this pooled connection.
 */
export async function asUser<T>(
  userId: string,
  work: (db: VaultTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('safehouse.user_id', ${userId}, true)`,
    );
    return work(tx);
  });
}

export type DatabaseStatus = { ok: true } | { ok: false; error: string };

/**
 * Prove the whole chain — app, driver, Postgres — is alive.
 *
 * The query runner is injectable so this can be tested without a database.
 */
export async function checkDatabase(
  runQuery: () => Promise<unknown> = () => getDb().execute(sql`select 1`),
): Promise<DatabaseStatus> {
  try {
    await runQuery();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
