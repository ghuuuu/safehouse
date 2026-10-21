import { Form, Link, redirect, useSearchParams } from "react-router";

import type { Route } from "./+types/sign-in";
import { auth, noUsersYet, unlessLocked } from "../auth.server";
import { TOO_MANY_TRIES } from "../tries.server";
import { DEV_LOGINS, devCredentials, devLoginsEnabled } from "../dev-logins.server";
import { getSignedInUser } from "../session.server";
import { safeNext } from "../next";
import { SignedOut } from "../signed-out";

export function meta() {
  return [{ title: "Sign in — SafeHouse" }];
}


export async function loader({ request }: Route.LoaderArgs) {
  if (await getSignedInUser(request)) throw redirect("/");
  return {
    firstRun: await noUsersYet(),
    // Names and roles only: the password never leaves the server.
    // `import.meta.env.DEV` first, so a production build drops the list.
    devLogins: import.meta.env.DEV && devLoginsEnabled() ? DEV_LOGINS.map(({ email, name, role, note }) => ({ email, name, role, note })) : [],
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const next = safeNext(form.get("next"));

  // A development button sends only which fictional account; the password is
  // added on the server, and only when the buttons are on. A production build
  // compiles this to null and drops app/dev-logins.server.ts.
  const dev = import.meta.env.DEV ? devCredentials(form) : null;
  if (dev === false) return { error: "That email and password do not match." };

  const response = await unlessLocked(
    auth.api.signInEmail({
      body: dev ?? {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      },
      headers: request.headers,
      asResponse: true,
    }),
  );

  if (!response) return { error: TOO_MANY_TRIES };

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
    <SignedOut title="Sign in">
      <p className="-mt-4 text-sm text-gray-500 max-w-prose">Sign in to the household.</p>

      {loaderData.firstRun ? (
        <p className="border-y border-gray-200 py-3 text-sm text-gray-600">
          Nobody has an account here yet.{" "}
          <Link className="underline" to="/setup">
            Create the first one
          </Link>
          .
        </p>
      ) : null}

      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="next" value={params.get("next") ?? "/"} />

        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            className="field font-normal"
            type="email"
            name="email"
            autoComplete="username"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            className="field font-normal"
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </label>

        {actionData?.error ? (
          <p className="text-sm text-red-700 dark:text-red-400">{actionData.error}</p>
        ) : null}

        <button className="btn btn-primary w-full" type="submit">
          Sign in
        </button>
      </Form>
      {import.meta.env.DEV && loaderData.devLogins.length > 0 ? <DevLogins logins={loaderData.devLogins} next={params.get("next") ?? "/"} /> : null}
    </SignedOut>
  );
}

/**
 * Development only: the loader sends an empty list in any production build
 * or against a database off this machine. Each button is a real sign-in
 * through the form's own action, as that fictional account.
 */
function DevLogins({ logins, next }: { logins: { email: string; name: string; role: string; note: string }[]; next: string }) {
  return (
    <section aria-labelledby="dev-logins" className="flex flex-col gap-3 border-t border-gray-200 pt-4">
      <div>
        <h2 id="dev-logins" className="text-sm font-semibold">Sign in as… (development)</h2>
        <p className="mt-1 text-xs text-gray-500">Fictional accounts. These buttons do not exist in a real install.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {logins.map((login) => (
          <li key={login.email}>
            <Form method="post">
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="dev-login" value={login.email} />
              <button
                type="submit"
                className="btn btn-secondary w-full flex-col items-start gap-0.5 whitespace-normal text-left"
              >
                <span className="text-sm font-semibold">{login.role}</span>
                <span className="text-xs font-normal text-gray-500">{login.name} · {login.note}</span>
              </button>
            </Form>
          </li>
        ))}
      </ul>
    </section>
  );
}
