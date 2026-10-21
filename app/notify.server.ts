/**
 * Notifications beyond the app (Step 17, D13, D37).
 *
 * One channel: a webhook, `SAFEHOUSE_NOTIFY_WEBHOOK`, which covers ntfy, a
 * Telegram bot, or anything else that takes a POST. Read from the environment
 * and never stored: a topic or bot URL is a secret, and the settings row is
 * readable by everybody signed in. SMTP would need a dependency and is not
 * here (D37).
 *
 * What leaves the house is a sentence with no title, no name and no value
 * (D13, CLAUDE.md): "A document in Safehouse expires in 9 days." The vault is
 * where you go to find out which.
 *
 * Who it goes to: active admins. They can see every document, and a household
 * has one channel. Members keep the live expiry list in the app (D30).
 *
 * How it runs: a sweep at boot and every 15 minutes, in-process, and once more
 * straight after a break-glass. Each sweep writes `expiry.soon` rows as each
 * admin (once per document per stage, `stage` below; the database refuses a
 * second) and then delivers
 * whatever is undelivered. A job that fails silently is what D30 refused, so
 * this one cannot: every attempt is recorded on its row, failures are shown to
 * the admin on the dashboard, and so is a sweep that has stopped running.
 */

import { sql } from "drizzle-orm";

import { activeAdminIds } from "./auth.server";
import { asUser, type VaultTransaction } from "./db.server";
import { findExpiring } from "./expiry.server";

export type Sender = (text: string) => Promise<void>;

/** After this many failures a row stops being retried, and stays visible. */
const MAX_ATTEMPTS = 5;
const SWEEP_EVERY_MS = 15 * 60_000;

/** The configured webhook, or null. The URL never appears in an error. */
export function webhookSender(
  url = process.env.SAFEHOUSE_NOTIFY_WEBHOOK,
  timeoutMs = 10_000,
): Sender | null {
  if (!url) return null;
  return async (text) => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: text,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // No `cause`, on purpose: fetch's own error can quote the URL, and the
      // URL is the secret (an ntfy topic, a bot token).
      // eslint-disable-next-line preserve-caught-error
      throw new Error((error as Error).name === "TimeoutError" ? "timed out" : "could not connect");
    }
    // The body is not read: it is the far end's, and could say anything.
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  };
}

export function message(kind: string, daysLeft: number | null): string {
  if (kind === "emergency.activated") {
    return "SafeHouse: an emergency contact has opened the vault (break-glass). Open SafeHouse to see who, and close it if it should not be open.";
  }
  if (kind === "expiry.soon" && daysLeft !== null) {
    const when =
      daysLeft < 0 ? `expired ${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`
      : daysLeft === 0 ? "expires today"
      : `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    return `SafeHouse: a document ${when}. Open SafeHouse to see which.`;
  }
  return "SafeHouse: something needs your attention. Open SafeHouse.";
}

/**
 * Which reminder a paper is due: when it entered the window, a week out, three
 * days out, on the day. Only the one it is in now, so a paper first seen two
 * days out is told of once rather than three times (0019).
 */
export function stage(daysLeft: number): "early" | "week" | "three" | "today" {
  return daysLeft <= 0 ? "today" : daysLeft <= 3 ? "three" : daysLeft <= 7 ? "week" : "early";
}

/** As the admin: one reminder row per expiring document per stage, once. */
export async function writeExpiryReminders(db: VaultTransaction): Promise<number> {
  const { soon } = await findExpiring(db);
  let written = 0;
  for (const item of soon) {
    const rows = await db.execute(sql`
      insert into notifications (user_id, kind, subject_type, subject_id, stage)
      values (current_app_user(), 'expiry.soon', 'document', ${item.documentId}, ${stage(item.daysLeft)})
      on conflict (user_id, subject_id, stage) where kind = 'expiry.soon' do nothing
      returning id
    `);
    written += rows.length;
  }
  return written;
}

type Pending = { id: string; kind: string; daysLeft: number | null };

let queue: Promise<unknown> = Promise.resolve();

/**
 * One delivery at a time. A break-glass delivers at once (`deliverNow`) while
 * a sweep may be part-way through the same rows, and both read them as
 * undelivered: run together, every message went out twice.
 *
 * ponytail: in-process, like the sweeper (one container). A second would need
 * the rows claimed in the database before sending.
 */
export function deliverFor(userId: string, send: Sender): Promise<{ sent: number; failed: number }> {
  const run = queue.then(() => deliverPending(userId, send));
  queue = run.catch(() => {});
  return run;
}

/** Read in one transaction, sent outside any, recorded in another. */
async function deliverPending(userId: string, send: Sender): Promise<{ sent: number; failed: number }> {
  const pending = await asUser(userId, async (db) => [
    ...(await db.execute<Pending>(sql`
      select n.id, n.kind, (d.expires_on - current_date) as "daysLeft"
      from notifications n
      left join documents d on n.kind = 'expiry.soon' and d.id = n.subject_id
      where n.user_id = current_app_user()
        and n.delivered_at is null
        and n.delivery_attempts < ${MAX_ATTEMPTS}
      order by n.created_at
    `)),
  ]);

  let sent = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      await send(message(row.kind, row.daysLeft));
      await asUser(userId, (db) =>
        db.execute(sql`
          update notifications set delivered_at = now(), delivery_error = null,
            delivery_attempts = delivery_attempts + 1
          where id = ${row.id}
        `),
      );
      sent++;
    } catch (error) {
      const reason = String((error as Error).message ?? "failed").slice(0, 80);
      await asUser(userId, (db) =>
        db.execute(sql`
          update notifications set delivery_error = ${reason},
            delivery_attempts = delivery_attempts + 1
          where id = ${row.id}
        `),
      );
      failed++;
    }
  }
  return { sent, failed };
}

let last: { at: Date; failed: number } | null = null;

/** When the sweep last finished, for the dashboard. Null before the first. */
export function lastSweep() {
  return last;
}

export async function sweep(
  send: Sender | null = webhookSender(),
  admins: () => Promise<string[]> = activeAdminIds,
): Promise<{ written: number; sent: number; failed: number }> {
  let written = 0;
  let sent = 0;
  let failed = 0;

  for (const admin of await admins()) {
    written += await asUser(admin, writeExpiryReminders);
    if (send) {
      const result = await deliverFor(admin, send);
      sent += result.sent;
      failed += result.failed;
    }
  }

  last = { at: new Date(), failed };
  return { written, sent, failed };
}

export type DeliveryStatus = {
  channel: boolean;
  /** Rows that tried and failed, and have not been delivered since. */
  failing: number;
  lastSweepAt: string | null;
  /** True when no sweep has finished for over an hour while the server ran. */
  stale: boolean;
};

/** For the signed-in user's own rows (the read policy keeps it so). */
export async function deliveryStatus(db: VaultTransaction): Promise<DeliveryStatus> {
  const [row] = await db.execute<{ failing: number }>(sql`
    select count(*)::int as failing from notifications
    where delivered_at is null and delivery_error is not null
  `);
  const sweptAt = last?.at ?? null;
  return {
    channel: Boolean(process.env.SAFEHOUSE_NOTIFY_WEBHOOK),
    failing: row?.failing ?? 0,
    lastSweepAt: sweptAt?.toISOString() ?? null,
    stale: started !== null && Date.now() - (sweptAt ?? started).getTime() > 60 * 60_000,
  };
}

let started: Date | null = null;

/**
 * Run the sweep now and every 15 minutes. Called once from the server entry.
 *
 * ponytail: an in-process timer, because there is one container (D3, D9). A
 * second container would sweep twice; the unique index keeps that to one row
 * per document, but a delivery could go out twice.
 */
export function startSweeper(): void {
  if (started) return;
  started = new Date();
  const run = () =>
    sweep().catch(() => {
      // The error is not logged: it can carry a database row. The dashboard
      // shows a sweep that has stopped finishing.
    });
  void run();
  setInterval(run, SWEEP_EVERY_MS).unref();
}

/** After a break-glass: deliver now, without waiting for the next sweep. */
export function deliverNow(): void {
  const send = webhookSender();
  if (!send) return;
  void activeAdminIds()
    .then((admins) => Promise.all(admins.map((admin) => deliverFor(admin, send))))
    .catch(() => {});
}
