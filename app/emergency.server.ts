/**
 * Break-glass (D19): opening a window, closing one, and seeing which are open.
 *
 * Everything that makes this safe is in `0015_break_glass_and_notifications.sql`:
 * who may open one, how long it may last, that admins are alerted, that only an
 * admin closes one and nobody extends one. These functions are the shape of the
 * request, plus the activity log line.
 */

import { sql } from "drizzle-orm";

import { ACTIONS, record } from "./activity.server";
import type { VaultTransaction } from "./db.server";

export type Window = { id: string; userId: string; name: string | null; expiresAt: string; reason: string | null };

/**
 * The open windows the caller may see: their own, or, for an admin, everybody's
 * (`emergency_activations_read`). The reason is the contact's own words to the
 * admin and stays in the app; it is never part of a notification.
 */
export async function openWindows(db: VaultTransaction): Promise<Window[]> {
  return [
    ...(await db.execute<Window>(sql`
      select e.id, e.user_id as "userId", u.name, e.reason,
             to_char(e.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "expiresAt"
      from emergency_activations e
      left join users u on u.id = e.user_id
      where e.revoked_at is null and e.expires_at > now()
      order by e.expires_at
    `)),
  ];
}

export type OpenResult = { ok: true } | { ok: false; problem: string };

/** As the emergency contact, for themselves, for the household's full window. */
export async function openWindow(db: VaultTransaction, reason: string): Promise<OpenResult> {
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false, problem: "Say in a few words why. The administrator will read it." };
  if (trimmed.length > 500) return { ok: false, problem: "That reason is too long." };

  await db.execute(sql`
    insert into emergency_activations (user_id, expires_at, reason)
    values (
      current_app_user(),
      now() + make_interval(hours => (select emergency_window_hours from settings where id = 1)),
      ${trimmed}
    )
  `);
  await record(db, {
    action: ACTIONS.emergencyOpened,
    subjectType: "user",
    subjectId: (await db.execute<{ id: string }>(sql`select current_app_user() as id`))[0].id,
  });
  return { ok: true };
}

/** As an admin: close every open window of this contact. Returns how many. */
export async function revokeWindows(db: VaultTransaction, userId: string): Promise<number> {
  const closed = await db.execute(sql`
    update emergency_activations
    set revoked_at = now(), revoked_by = current_app_user()
    where user_id = ${userId} and revoked_at is null and expires_at > now()
    returning id
  `);
  if (closed.length > 0) {
    await record(db, { action: ACTIONS.emergencyRevoked, subjectType: "user", subjectId: userId });
  }
  return closed.length;
}
