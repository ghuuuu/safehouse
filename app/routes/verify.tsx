import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/verify";
import { passwordMatches } from "../auth.server";
import { requireUser } from "../session.server";
import { grantStepUp, STEP_UP_SECONDS } from "../stepup.server";

export function meta() {
  return [{ title: "Confirm it is you — Safehouse" }];
}

/** Only ever back into this server, never to wherever a query string says. */
function safeNext(value: FormDataEntryValue | string | null): string {
  const next = String(value ?? "");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/vault";
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);

  return {
    name: user.name,
    next: safeNext(url.searchParams.get("next")),
    // Sent from the loader rather than imported into the component: the module
    // that knows this number is a server module, and the form only needs to
    // say it out loud.
    minutes: Math.round(STEP_UP_SECONDS / 60),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const next = safeNext(form.get("next"));

  const ok = await passwordMatches(user.id, String(form.get("password") ?? ""));

  if (!ok) {
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-6 md:p-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Confirm it is you</h1>
        <p className="mt-2 text-sm text-gray-500 max-w-prose">
          Opening a document asks for your password again, {loaderData.name}. A
          signed-in browser somebody walked away from should not be able to pull
          papers out of the vault. It will not ask again for {loaderData.minutes} minutes.
        </p>
      </div>

      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="next" value={loaderData.next} />

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            required
            className="rounded-lg border border-gray-300 p-2"
          />
        </label>

        {actionData?.error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
          >
            {actionData.error}
          </p>
        ) : null}

        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white"
        >
          Confirm
        </button>
      </Form>

      <Link className="text-sm text-gray-500 underline" to="/vault">
        Back to the vault
      </Link>
    </main>
  );
}
