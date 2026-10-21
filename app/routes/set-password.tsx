import { useEffect, useState } from "react";
import { Form, redirect } from "react-router";

import type { Route } from "./+types/set-password";
import { MIN_PASSWORD, setPasswordWithLink } from "../auth.server";
import { SignedOut } from "../signed-out";

export function meta() {
  return [{ title: "Set your password — SafeHouse" }];
}

/**
 * Where an invite or reset link lands (D32).
 *
 * Reachable without signing in, because the link is the credential. The token
 * arrives in the fragment, which the browser never sends, so this page needs
 * JavaScript to read it: it copies the token into the form and wipes it from
 * the address bar, so it is not left in history either.
 */
export function loader() {
  return { minPassword: MIN_PASSWORD };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();

  const result = await setPasswordWithLink(
    String(form.get("token") ?? ""),
    String(form.get("password") ?? ""),
  );

  if (!result.ok) return { error: result.problem };
  throw redirect("/sign-in");
}

export default function SetPassword({ loaderData, actionData }: Route.ComponentProps) {
  const { minPassword } = loaderData;
  const [token, setToken] = useState("");

  useEffect(() => {
    const fromLink = window.location.hash.slice(1);
    if (!fromLink) return;
    setToken(fromLink);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return (
    <SignedOut title="Set your password">
      <p className="-mt-4 text-sm text-gray-500 max-w-prose">
        Then sign in with your email and this password.
      </p>

      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />

        <label className="flex flex-col gap-1 text-sm font-medium">
          New password
          <input
            className="field font-normal"
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={minPassword}
            required
          />
          <span className="text-xs font-normal text-gray-500">
            At least {minPassword} characters.
          </span>
        </label>

        {actionData?.error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {actionData.error}
          </p>
        ) : null}

        <button className="btn btn-primary w-full" type="submit">
          Set password
        </button>
      </Form>
    </SignedOut>
  );
}
