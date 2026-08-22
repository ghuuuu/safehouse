import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { requireEnv } from "./config.server";

let cached: ReturnType<typeof drizzle> | undefined;

/**
 * The database handle, created on first use so that importing this module —
 * in a test, for instance — does not require a live connection.
 */
export function getDb() {
  if (!cached) {
    cached = drizzle(postgres(requireEnv("DATABASE_URL"), { max: 10 }));
  }

  return cached;
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
