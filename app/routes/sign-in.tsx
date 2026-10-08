import { Form, Link, redirect, useSearchParams } from "react-router";

import type { Route } from "./+types/sign-in";
import { auth, noUsersYet } from "../auth.server";
import { getSignedInUser } from "../session.server";
import { safeNext } from "../next";

export function meta() {
  return [{ title: "Sign in — Safehouse" }];
}


export async function loader({ request }: Route.LoaderArgs) {
  if (await getSignedInUser(request)) throw redirect("/");
  return { firstRun: await noUsersYet() };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const next = safeNext(form.get("next"));

  const response = await auth.api.signInEmail({
    body: {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    },
    headers: request.headers,
    asResponse: true,
  });

  if (!response.ok) {
    // The same sentence whether the address is unknown or the password is
    // wrong. Telling them apart would turn this form into a way to ask which
    // of your relatives has an account here.
    return { error: "That email and password do not match." };
  }

  // With two-factor on, the password earns no session yet: only a short-lived
  // cookie that lets the next page ask for a code (D36).
  const body = (await response.clone().json().catch(() => ({}))) as { twoFactorRedirect?: boolean };
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);

  if (body.twoFactorRedirect) {
    return redirect(`/sign-in/code?next=${encodeURIComponent(next)}`, { headers });
  }

  return redirect(next, { headers });
}

export default function SignIn({ loaderData, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-6 md:p-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Safehouse</h1>
        <p className="mt-1 text-sm text-gray-500 max-w-prose">Sign in to the household.</p>
      </div>

      {loaderData.firstRun ? (
        <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600">
          Nobody has an account here yet.{" "}
          <Link className="underline" to="/setup">
            Create the first one
          </Link>
          .
        </p>
      ) : null}

      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="next" value={params.get("next") ?? "/"} />

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Email</span>
          <input
            className="rounded-lg border border-gray-300 p-2"
            type="email"
            name="email"
            autoComplete="username"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Password</span>
          <input
            className="rounded-lg border border-gray-300 p-2"
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </label>

        {actionData?.error ? (
          <p className="text-sm text-red-700 dark:text-red-400">{actionData.error}</p>
        ) : null}

        <button
          className="rounded-lg bg-gray-900 p-2 text-sm text-white"
          type="submit"
        >
          Sign in
        </button>
      </Form>
    </main>
  );
}
