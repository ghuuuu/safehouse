/**
 * Proving it is still you, shortly before the vault hands over a document.
 *
 * A valid session says somebody signed in on this browser at some point. It
 * does not say they are still the one at the keyboard, and a borrowed laptop
 * with a live session should not be able to pull a passport out of the vault.
 * So a download asks for the password again and remembers the answer for a few
 * minutes (D4's consequences: revealing a masked field and downloading a file
 * are step-up actions, not session actions).
 *
 * The marker is a signed cookie rather than a database row because it is
 * exactly session-shaped: short-lived, per-browser, and worthless to anybody
 * who cannot already make this server's signature. React Router signs and
 * verifies it with the same secret the auth library uses — nothing here
 * invents cryptography.
 *
 * It is bound to a user id, so signing out and in as somebody else does not
 * inherit the previous person's step-up.
 */

import { createCookie } from "react-router";

import { requireEnv } from "./config.server";
import type { SignedInUser } from "./session.server";

/**
 * Five minutes. Long enough to download several things from one record
 * without the form becoming the product; short enough that walking away from
 * an unlocked laptop does not leave the vault open behind you.
 */
export const STEP_UP_SECONDS = 5 * 60;

type StepUp = { userId: string; at: number };

const cookie = createCookie("safehouse_stepup", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  // The library's rule for its own cookies: Secure exactly when the vault is
  // served over https. A browser drops a Secure cookie set over plain http,
  // so marking it Secure by build would ask for the password forever there.
  secure: requireEnv("BETTER_AUTH_URL").startsWith("https://"),
  maxAge: STEP_UP_SECONDS,
  secrets: [requireEnv("BETTER_AUTH_SECRET")],
});

/** How long this browser has left, in seconds. Zero when it has none. */
export async function stepUpRemaining(
  request: Request,
  user: SignedInUser,
  now: number = Date.now(),
): Promise<number> {
  const value = (await cookie.parse(request.headers.get("cookie"))) as
    | StepUp
    | null;

  if (!value || value.userId !== user.id) return 0;

  const elapsed = (now - value.at) / 1000;
  if (elapsed < 0 || elapsed > STEP_UP_SECONDS) return 0;

  return Math.ceil(STEP_UP_SECONDS - elapsed);
}

/**
 * Demand a recent password check, or send them to give one.
 *
 * Throws a redirect rather than returning a verdict, so a loader that forgets
 * to check the result cannot carry on and serve the file anyway.
 */
export async function requireStepUp(
  request: Request,
  user: SignedInUser,
): Promise<void> {
  if ((await stepUpRemaining(request, user)) > 0) return;

  const url = new URL(request.url);
  const next = `${url.pathname}${url.search}`;

  throw new Response(null, {
    status: 302,
    headers: { location: `/verify?next=${encodeURIComponent(next)}` },
  });
}

/** The Set-Cookie header that starts the window. */
export function grantStepUp(
  user: SignedInUser,
  now: number = Date.now(),
): Promise<string> {
  return cookie.serialize({ userId: user.id, at: now } satisfies StepUp);
}

/** The Set-Cookie header that ends it early. */
export function clearStepUp(): Promise<string> {
  return cookie.serialize("", { maxAge: 0 });
}
