/**
 * What is about to run out.
 *
 * A reminder here is a **question asked of the database**, not a row written by
 * a job. Nothing is scheduled, nothing is queued, and there is no state to go
 * stale: the list is recomputed against the database's own clock every time
 * somebody looks. A cron that fails to run is a reminder that never arrives,
 * and nobody notices the absence of a thing — which is the worst failure mode a
 * vault of expiring papers can have. See D30.
 *
 * Two rules decide what is in it, and both are refusals:
 *
 *   * Only a **confirmed** date counts (D26). The reader proposes expiry dates
 *     now, and a proposal is a machine's guess. A vault that nags about guesses
 *     teaches its household to ignore it, and then the real warning is ignored
 *     too.
 *   * Only the **current** version counts (D20). A superseded passport expired
 *     years ago by design; saying so every time the page loads is noise.
 *
 * And two more of the same kind: nothing more than a year gone, and nothing
 * of somebody who has died. Neither is a renewal anybody is going to make.
 *
 * Who is told is decided where it always is. This reads `documents` and
 * `records` through the ordinary policies, so a document the viewer may not open
 * produces no row and therefore no reminder — there is no filtering here to get
 * wrong (CLAUDE.md). Nothing in this module logs: a title printed beside a date
 * is a record field value.
 */

import { sql } from "drizzle-orm";

import type { VaultTransaction } from "./db.server";

export type Expiring = {
  documentId: string;
  recordId: string;
  title: string;
  category: string;
  /** Null when the viewer reached the record without its owner (D17). */
  ownerName: string | null;
  /** Null exactly when `ownerName` is. The dashboard splits on it. */
  ownerKind: "person" | "business" | "household" | null;
  /** From `owners`, so null exactly when `ownerName` is: the map's tag needs it. */
  ownerId: string | null;
  expiresOn: string;
  /** Negative once it has already gone. */
  daysLeft: number;
};

export type ExpiringSoon = {
  /** How far ahead the household looks. Null when there was nobody to ask for. */
  leadDays: number | null;
  soon: Expiring[];
};

export async function findExpiring(
  db: VaultTransaction,
): Promise<ExpiringSoon> {
  const settings = await db.execute<{ leadDays: number }>(sql`
    select expiry_reminder_lead_days as "leadDays" from settings where id = 1
  `);

  // `settings_read` is behind the same `current_app_user() is not null` rule as
  // the rest of the vault, so a transaction that never named a user finds no
  // row here. That is the same empty answer every other surface gives, rather
  // than a default that would quietly look sixty days ahead for nobody.
  const leadDays = [...settings][0]?.leadDays ?? null;
  if (leadDays === null) return { leadDays: null, soon: [] };

  const rows = await db.execute<Expiring>(sql`
    select
      d.id as "documentId",
      r.id as "recordId",
      r.title,
      r.category,
      o.display_name as "ownerName",
      o.kind::text as "ownerKind",
      o.id as "ownerId",
      -- Rendered by Postgres rather than parsed back from a Date, so a
      -- timezone between here and the browser cannot move it a day.
      to_char(d.expires_on, 'YYYY-MM-DD') as "expiresOn",
      (d.expires_on - current_date) as "daysLeft"
    from documents d
    join records r on r.id = d.record_id
    left join owners o on o.id = r.owner_id
    where d.is_current
      and d.expires_on is not null
      and jsonb_exists(d.confirmed_fields, 'expires_on')
      -- current_date, not a date computed in Node. The container's clock and
      -- the database's can disagree, and only one of them wrote the row.
      and d.expires_on - current_date <= ${leadDays}
      -- A year gone, it is history — an old passport kept for the record —
      -- not a renewal anybody is still going to make.
      and d.expires_on - current_date >= -365
      -- Nor is a renewal for somebody who has died. Read through the policies
      -- like the rest: a viewer who cannot see the person is still reminded.
      and not exists (select 1 from people p where p.owner_id = r.owner_id and p.died_on is not null)
    order by d.expires_on, r.title
  `);

  return { leadDays, soon: [...rows] };
}
