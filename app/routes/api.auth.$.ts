import type { Route } from "./+types/api.auth.$";

import { auth } from "../auth.server";

/**
 * Everything the auth library serves: sign-in, sign-out, session.
 *
 * A resource route with no component, so nothing here renders and nothing here
 * reads the vault. GET and POST both hand the request straight to the library.
 */
export async function loader({ request }: Route.LoaderArgs) {
  return auth.handler(request);
}

export async function action({ request }: Route.ActionArgs) {
  return auth.handler(request);
}
