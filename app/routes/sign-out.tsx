import { redirect } from "react-router";

import type { Route } from "./+types/sign-out";
import { auth } from "../auth.server";
import { clearStepUp } from "../stepup.server";

/**
 * Signing out deletes the session row (D10), so it takes effect on the next
 * request rather than whenever a cookie happens to expire.
 *
 * POST only: a GET would let any page on the internet sign somebody out by
 * embedding an image.
 */
export async function action({ request }: Route.ActionArgs) {
  const response = await auth.api.signOut({
    headers: request.headers,
    asResponse: true,
  });

  // The library's cookies, and the step-up cookie gone too: signing back in
  // should ask for the password again before a file opens (D4).
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  headers.append("set-cookie", await clearStepUp());
  return redirect("/sign-in", { headers });
}

export function loader() {
  throw redirect("/");
}
