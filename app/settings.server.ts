/**
 * Reading and changing the household's settings (Step 16).
 *
 * Read by anybody signed in (`settings_read`, 0001); changed only by an active
 * admin (`settings_update`, 0014), with each range held by a check constraint.
 * The checks here exist only to turn a bad value into a sentence.
 */

import { sql } from "drizzle-orm";

import { ACTIONS, record } from "./activity.server";
import type { VaultTransaction } from "./db.server";
import { LIMITS, type HouseholdSettings } from "./settings";

export async function readSettings(db: VaultTransaction): Promise<HouseholdSettings | null> {
  const [row] = await db.execute<HouseholdSettings>(sql`
    select expiry_reminder_lead_days as "expiryReminderLeadDays",
           emergency_window_hours as "emergencyWindowHours",
           auto_lock_minutes as "autoLockMinutes"
    from settings where id = 1
  `);
  return row ?? null;
}

export type SaveResult = { ok: true } | { ok: false; problem: string };

const NAMES: Record<keyof HouseholdSettings, string> = {
  expiryReminderLeadDays: "How far ahead to warn",
  emergencyWindowHours: "How long an emergency window lasts",
  autoLockMinutes: "Auto-lock",
};

export async function saveSettings(db: VaultTransaction, values: HouseholdSettings): Promise<SaveResult> {
  for (const key of Object.keys(LIMITS) as (keyof HouseholdSettings)[]) {
    const { min, max } = LIMITS[key];
    const value = values[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      return { ok: false, problem: `${NAMES[key]} must be between ${min} and ${max}.` };
    }
  }

  const updated = await db.execute(sql`
    update settings
    set expiry_reminder_lead_days = ${values.expiryReminderLeadDays},
        emergency_window_hours = ${values.emergencyWindowHours},
        auto_lock_minutes = ${values.autoLockMinutes}
    where id = 1
    returning 1
  `);

  // Zero rows is what a refused update looks like under row-level security.
  if (updated.length === 0) {
    return { ok: false, problem: "Only the household administrator can change these." };
  }

  await record(db, { action: ACTIONS.settingsChanged, subjectType: "settings", subjectId: null });
  return { ok: true };
}
