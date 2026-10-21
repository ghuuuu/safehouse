import { Form, Link, redirect, useSearchParams } from "react-router";

import type { Route } from "./+types/sign-in.code";
import { auth } from "../auth.server";
import { safeNext } from "../next";
import { SignedOut } from "../signed-out";

export function meta() {
  return [{ title: "Your code — SafeHouse" }];
}

/**
 * The second half of signing in, when two-factor is on (D36).
 *
 * The password step left a signed, ten-minute cookie and no session. This page
 * spends a code from the authenticator app, or one backup code, against it.
 * The library checks the code and counts failures toward its own lockout.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const next = safeNext(form.get("next"));
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  const backup = form.get("kind") === "backup";

  const response = backup
    ? await auth.api.verifyBackupCode({ body: { code }, headers: request.headers, asResponse: true })
    : await auth.api.verifyTOTP({ body: { code }, headers: request.headers, asResponse: true });

  if (!response.ok) {
    return { error: "That code did not work. Codes change every 30 seconds; if this keeps happening, start again." };
  }

  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return redirect(next, { headers });
}

export default function SignInCode({ actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  return (
    <SignedOut title="Your code">
      <p className="-mt-4 text-sm text-gray-500 max-w-prose">
        The six digits your authenticator app shows for SafeHouse.
      </p>

      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Code
          <input
            className="field font-mono font-normal tracking-widest"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
          />
        </label>
        {actionData?.error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">{actionData.error}</p>
        ) : null}
        <button className="btn btn-primary w-full" type="submit">
          Sign in
        </button>
      </Form>

      <details className="border-t border-gray-200 pt-4 text-sm">
        <summary className="cursor-pointer text-gray-500">Lost your phone? Use a backup code</summary>
        <Form method="post" className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="kind" value="backup" />
          <input className="field font-mono" name="code" aria-label="Backup code" required />
          <button className="btn btn-secondary self-start" type="submit">
            Use backup code
          </button>
          <p className="text-xs text-gray-500 max-w-prose">Each backup code works once.</p>
        </Form>
      </details>

      <Link className="text-sm text-gray-500 underline" to="/sign-in">Start again</Link>
    </SignedOut>
  );
}
