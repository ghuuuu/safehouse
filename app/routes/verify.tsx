import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/verify";
import { passwordMatches } from "../auth.server";
import { requireUser } from "../session.server";
import { grantStepUp, STEP_UP_SECONDS } from "../stepup.server";
import { TOO_MANY_TRIES } from "../tries.server";
import { safeNext } from "../next";
import { SignedOut } from "../signed-out";

export function meta() {
  return [{ title: "Confirm it is you — SafeHouse" }];
}

/** Only ever back into this server, never to wherever a query string says. */
const backTo = (value: FormDataEntryValue | string | null) => safeNext(value, "/vault");

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);

  return {
    name: user.name,
    next: backTo(url.searchParams.get("next")),
    // Sent from the loader rather than imported into the component: the module
    // that knows this number is a server module, and the form only needs to
    // say it out loud.
    minutes: Math.round(STEP_UP_SECONDS / 60),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const next = backTo(form.get("next"));

  const answer = await passwordMatches(user.id, String(form.get("password") ?? ""));

  if (answer === "locked") return { error: TOO_MANY_TRIES };
  if (answer === "wrong") {
    // One message, and no indication whether the account even has a password
    // set — the asker is already signed in as this person, but the page should
    // not become a way to confirm anything about them either.
    return { error: "That password did not match." };
  }

  return redirect(next, {
    headers: { "set-cookie": await grantStepUp(user) },
  });
}

export default function Verify({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <SignedOut title="Confirm it is you">
      <p className="-mt-4 text-sm text-gray-500 max-w-prose">
        Opening a document asks for your password again, {loaderData.name}. A
        signed-in browser somebody walked away from should not be able to pull
        papers out of the vault. It will not ask again for {loaderData.minutes} minutes.
      </p>

      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="next" value={loaderData.next} />

        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            required
            className="field font-normal"
          />
        </label>

        {actionData?.error ? (
          <p
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
          >
            {actionData.error}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary w-full">
          Confirm
        </button>
      </Form>

      <Link className="text-sm text-gray-500 underline" to="/vault">
        Back to the vault
      </Link>
    </SignedOut>
  );
}
