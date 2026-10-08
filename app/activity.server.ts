/**
 * Writing down who looked at what.
 *
 * Two decisions oblige this to exist. D14 accepts that record field values sit
 * readable in the database, and in exchange requires that every reveal of a
 * masked value is logged. D19 requires every access made during an emergency
 * window to be logged and alerted. Neither promise means anything unless the
 * write happens in the same transaction as the thing it records — a log written
 * afterwards, best effort, is a log that is missing exactly the entries
 * somebody would most want missing.
 *
 * So `record` takes the caller's transaction rather than opening its own. If
 * the log write fails, the read it was recording fails with it, and no bytes
 * are handed over. That is the right way round: a vault that serves a document
 * it could not record is worse than one that briefly refuses.
 *
 * What goes in a line: who, whose eyes they were using, what they did, and
 * which row it was about. Never a title, a file name, a storage key or a field
 * value (CLAUDE.md) — the log says a document was opened, and the vault is
 * where you go to find out which.
 */

import { sql } from "drizzle-orm";

import type { VaultTransaction } from "./db.server";

export const ACTIONS = {
  documentDownloaded: "document.downloaded",
  documentFiled: "document.filed",
  vaultViewedAs: "vault.viewed-as",
  fieldRevealed: "field.revealed",
  /**
   * A search matched a document by its number (D35). Logged like a reveal,
   * because a last-four match tells the searcher part of a masked value.
   */
  fieldMatched: "field.matched",
  documentRead: "document.read",
  /**
   * Somebody was added to the tree. Logged because a tree edge is read by
   * `family_circle`, so this line is the record of an access-control change —
   * closer in kind to granting a permission than to typing in a name.
   */
  personAdded: "person.added",
  /**
   * A person was given a sign-in, or an existing one a new link. Either way a
   * credential was handed out, and the log is the only record of who got one
   * from whom; the link itself is never written anywhere.
   */
  accountInvited: "account.invited",
  signInLinkMade: "account.link-made",
  /**
   * An account's access changed in the console. The subject is the account;
   * the target says which owner, record or category, by id or enum (0012).
   */
  grantAdded: "grant.added",
  grantRemoved: "grant.removed",
  /** The household's settings changed, the emergency window among them. */
  settingsChanged: "settings.changed",
  /** Break-glass (D19): a window opened by its contact, or closed by an admin. */
  emergencyOpened: "emergency.opened",
  emergencyRevoked: "emergency.revoked",
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

export type Event = {
  action: Action;
  /** The table the subject lives in: "document", "record", "user". */
  subjectType: string;
  /** Null for the one thing that has no id: the household's settings row. */
  subjectId: string | null;
  /** Whose eyes the actor was using, when they were not their own. */
  actingAsUserId?: string | null;
  /** What a grant line granted: an owner or record id, or a category. */
  targetId?: string | null;
  targetCategory?: string | null;
};

/**
 * Append one line, as the user the transaction belongs to.
 *
 * The actor is not a parameter on purpose. The policy takes it from the
 * transaction, so a caller cannot write a line in somebody else's name even by
 * accident, and this signature cannot tempt anyone to try.
 */
export async function record(
  db: VaultTransaction,
  event: Event,
): Promise<void> {
  await db.execute(sql`
    insert into activity_events
      (actor_user_id, acting_as_user_id, action, subject_type, subject_id,
       target_id, target_category)
    values (
      current_app_user(), ${event.actingAsUserId ?? null}, ${event.action},
      ${event.subjectType}, ${event.subjectId},
      ${event.targetId ?? null}, ${event.targetCategory ?? null}::category
    )
  `);
}
