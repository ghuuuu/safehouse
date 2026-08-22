import { redirect } from "react-router";
import { auth } from "./auth.server";
import { asUser, type VaultTransaction } from "./db.server";

/**
 * The join between "who is asking" and "what they may see".
 *
 * Sign-in happens on one database connection (auth.server.ts) and the vault is
 * read on another (db.server.ts). This module is the only place the two meet:
 * it turns a request's cookie into a user id, then opens a vault transaction in
 * that user's name. Everything else in the application goes through `withVault`
 * and therefore cannot query the vault anonymously by accident.
 */

export type SignedInUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  personOwnerId: string | null;
};

/**
 * The signed-in user, or null.
 *
 * A disabled account is treated as signed out from this moment, without waiting
 * for its session row to expire. The permission views drop disabled users too,
 * so an account disabled mid-session would see an empty vault either way; this
 * turns that into a sign-in page, which is the honest answer.
 */
export async function getSignedInUser(
  request: Request,
): Promise<SignedInUser | null> {
  const result = await auth.api.getSession({ headers: request.headers });
  if (!result?.user) return null;

  const user = result.user as typeof result.user & {
    role?: string | null;
    personOwnerId?: string | null;
    disabledAt?: Date | string | null;
  };

  if (user.disabledAt) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role ?? "individual",
    personOwnerId: user.personOwnerId ?? null,
  };
}

/**
 * The signed-in user, or a redirect to the sign-in page.
 *
 * Throws rather than returns, so a loader that forgets to check the result
 * still cannot continue unauthenticated.
 */
export async function requireUser(request: Request): Promise<SignedInUser> {
  const user = await getSignedInUser(request);
  if (user) return user;

  const url = new URL(request.url);
  const next = `${url.pathname}${url.search}`;
  throw redirect(
    next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`,
  );
}

/**
 * Read the vault as the signed-in user.
 *
 * The only supported way to query vault tables from a loader or action. The
 * transaction announces the user to Postgres, which is what makes every policy
 * in 0001_permission_layer.sql apply. A query run outside this function has no
 * user set and comes back empty.
 */
export async function withVault<T>(
  request: Request,
  work: (db: VaultTransaction, user: SignedInUser) => Promise<T>,
): Promise<T> {
  const user = await requireUser(request);
  return asUser(user.id, (db) => work(db, user));
}
