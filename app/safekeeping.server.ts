/**
 * Safekeeping (Step 19, D6, D12, D38): what the vault knows about the two jobs
 * that happen outside it, for the admin's dashboard.
 *
 * Neither can be done from here. A backup needs the owner's credentials, which
 * this container does not have (D22), and the key copy is a piece of paper. What
 * the app can do is notice when they have not happened, which is what keeps a
 * nightly job that quietly stopped from being found out on the worst day.
 */

import { sql } from "drizzle-orm";

import { ACTIONS, record } from "./activity.server";
import type { VaultTransaction } from "./db.server";

/** A weekly schedule, and a day's grace for it. */
const DRILL_EVERY_DAYS = 8;

export type Safekeeping = {
  /** When the newest backup a drill has proven was taken. Null: never. */
  drilledBackupAt: string | null;
  drillOverdue: boolean;
  /** For the key this server holds, not one it held before (D31). */
  keyCopyConfirmed: boolean;
};

/** As an admin. Anybody else reads no drills, and is never shown this. */
export async function readSafekeeping(db: VaultTransaction, keyId: string): Promise<Safekeeping> {
  const [row] = await db.execute<{ takenAt: string | null; overdue: boolean; confirmedFor: string | null }>(sql`
    select
      to_char(max(d.backup_taken_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "takenAt",
      coalesce(max(d.backup_taken_at) < now() - make_interval(days => ${DRILL_EVERY_DAYS}), true) as overdue,
      (select key_copy_confirmed_for from settings where id = 1) as "confirmedFor"
    from backup_drills d
  `);
  return {
    drilledBackupAt: row.takenAt,
    drillOverdue: row.overdue,
    keyCopyConfirmed: row.confirmedFor === keyId,
  };
}

/** The admin's word that this key is written down somewhere else. */
export async function confirmKeyCopy(db: VaultTransaction, keyId: string): Promise<boolean> {
  const updated = await db.execute(sql`
    update settings set key_copy_confirmed_for = ${keyId} where id = 1 returning 1
  `);
  if (updated.length === 0) return false;
  await record(db, { action: ACTIONS.keyCopyConfirmed, subjectType: "settings", subjectId: null });
  return true;
}
