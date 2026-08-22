import { redirect } from "react-router";

import type { Route } from "./+types/sign-out";
import { auth } from "../auth.server";

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

  const cookie = response.headers.get("set-cookie");
  return redirect("/sign-in", cookie ? { headers: { "set-cookie": cookie } } : {});
}

export function loader() {
  throw redirect("/");
}
