/**
 * Borrowing somebody else's eyes (PRODUCT.md, "Resolution").
 *
 * View-as is not a feature built on top of the permission model — it is the
 * permission model with one argument changed. The database's entire notion of
 * who is asking is one transaction-scoped setting (`app/db.server.ts`), so
 * rendering the vault as Maya means opening the transaction in Maya's name and
 * letting the same policies do the same work. Nothing is filtered here, and
 * there is no second copy of any rule.
 *
 * That is also why this module exists rather than a flag on `withVault`. The
 * switch has to be deliberate and it has to be gated, and the gate has to run
 * in the actor's own context: `perm.current_user_is_admin()` reads the setting
 * impersonation changes, so inside an impersonated transaction the database
 * correctly believes the actor is somebody else and cannot be asked whether
 * they were allowed to become them.
 */

import { sql } from "drizzle-orm";

import { asUser, type VaultTransaction } from "./db.server";
import { requireUser, type SignedInUser } from "./session.server";

/** Somebody an admin can choose to view the vault as. */
export type RosterEntry = {
  id: string;
  name: string;
  role: string;
  disabled: boolean;
};

export type ViewContext = {
  /** Who is really signed in. Never changes, whoever is being viewed. */
  actor: SignedInUser;
  /** The id the database will be told. The actor's own, unless viewing as. */
  viewedUserId: string;
  isViewingAs: boolean;
  /** Who those eyes belong to, or null when the actor is in their own. */
  viewedUser: RosterEntry | null;
  /** Who the actor may choose. Just themselves, unless they are an admin. */
  roster: RosterEntry[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Who the caller may choose from, written once so the tests run the statement
 * the picker runs.
 *
 * A plain select with no permission logic in it. Which rows come back is
 * `users_read`'s decision — an admin gets the household, anybody else gets a
 * list containing only themselves — and that is what makes this safe to render
 * as a dropdown.
 */
export const ROSTER_SQL = `
  select id, name, role, disabled_at is not null as disabled
  from users
  order by name
`;

/**
 * Decide whose eyes this request is entitled to, from the session alone.
 *
 * Pure, and deliberately so — it reads the actor's role from the session
 * cookie, which is resolved over the auth connection (D24) and not over the
 * impersonated one. Throws a `Response` rather than returning a verdict, so a
 * caller that forgets to check the result cannot continue anyway.
 */
export function gateViewAs(
  actor: SignedInUser,
  requested: string | null,
): { viewedUserId: string; isViewingAs: boolean } {
  const own = { viewedUserId: actor.id, isViewingAs: false };

  if (requested === null || requested === "") return own;
  if (requested === actor.id) return own;

  // Refusing for the role before looking at the value, so that somebody who
  // may not use this feature at all learns nothing about whether their guess
  // was well formed.
  if (actor.role !== "admin") {
    throw new Response("Only an administrator can view as another user.", {
      status: 403,
    });
  }

  if (!UUID.test(requested)) {
    // The value would reach `set_config` as a bound parameter, so this is not
    // what stands between the vault and an injection. It is here so a
    // malformed id fails loudly rather than becoming a transaction in the name
    // of a user nobody can be — which comes back empty and reads like a
    // permission bug rather than a typo.
    throw new Response("That is not a user id.", { status: 400 });
  }

  return { viewedUserId: requested, isViewingAs: true };
}

/**
 * The full picture: who is acting, whose eyes they have, and who else they
 * could choose.
 *
 * The roster is read in the actor's transaction, which matters more than it
 * looks: `users_read` is `id = current_app_user() or
 * perm.current_user_is_admin()`, so reading it while impersonating would
 * collapse it to the viewed user alone. It fails closed, and it fails
 * confusingly, so the ordering here is load-bearing.
 */
export async function resolveViewContext(
  request: Request,
): Promise<ViewContext> {
  const actor = await requireUser(request);
  const requested = new URL(request.url).searchParams.get("as");
  const { viewedUserId, isViewingAs } = gateViewAs(actor, requested);

  const roster = await asUser(actor.id, async (db) => {
    const rows = await db.execute<RosterEntry>(sql.raw(ROSTER_SQL));
    return [...rows];
  });

  const viewedUser = isViewingAs
    ? (roster.find((entry) => entry.id === viewedUserId) ?? null)
    : null;

  if (isViewingAs && !viewedUser) {
    // A well-formed id that is nobody. Safe to answer honestly: only an admin
    // reaches this line, and an admin can already list every account.
    throw new Response("No such user.", { status: 404 });
  }

  return { actor, viewedUserId, isViewingAs, viewedUser, roster };
}

/**
 * Read the vault as the viewed user — the impersonated context.
 *
 * The transaction is declared read-only to Postgres, so a write attempted
 * through borrowed eyes is refused by the database rather than by a promise
 * made in TypeScript. That promise used to be kept by there being no write
 * policy anywhere; `0005_write_policies.sql` ended that, and this is the guard
 * the view-as spec said the first write policy would owe.
 *
 * It is set even when nobody is being impersonated, because a function that
 * guards only the dangerous case has to be sure which case it is in, and this
 * one never writes either way.
 */
export async function withViewedVault<T>(
  context: ViewContext,
  work: (db: VaultTransaction) => Promise<T>,
): Promise<T> {
  return asUser(context.viewedUserId, async (db) => {
    await db.execute(sql`set transaction read only`);
    return work(db);
  });
}

/**
 * Read the vault as the actor themselves, while viewing as somebody else.
 *
 * Needed for exactly one thing: the denominator in "14 of 36". Two counts from
 * two user contexts cannot come from one transaction, because a transaction
 * has exactly one user set.
 */
export async function withActorVault<T>(
  context: ViewContext,
  work: (db: VaultTransaction) => Promise<T>,
): Promise<T> {
  return asUser(context.actor.id, work);
}
