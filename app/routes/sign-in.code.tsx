import { Form, Link, redirect, useSearchParams } from "react-router";

import type { Route } from "./+types/sign-in.code";
import { auth } from "../auth.server";
import { safeNext } from "../next";

export function meta() {
  return [{ title: "Your code — Safehouse" }];
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-6 md:p-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Your code</h1>
        <p className="mt-1 text-sm text-gray-500 max-w-prose">
          The six digits your authenticator app shows for Safehouse.
        </p>
      </div>

      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Code</span>
          <input
            className="rounded-lg border border-gray-300 p-2 tracking-widest"
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
        <button className="rounded-lg bg-accent px-4 py-2 text-sm text-on-accent" type="submit">
          Sign in
        </button>
      </Form>

      <details className="text-sm">
        <summary className="cursor-pointer text-gray-500">Lost your phone? Use a backup code</summary>
        <Form method="post" className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="kind" value="backup" />
          <input className="rounded-lg border border-gray-300 p-2" name="code" aria-label="Backup code" required />
          <button className="self-start rounded-lg border border-gray-300 px-4 py-2" type="submit">
            Use backup code
          </button>
          <p className="text-xs text-gray-500 max-w-prose">Each backup code works once.</p>
        </Form>
      </details>

      <Link className="text-sm text-gray-500 underline" to="/sign-in">Start again</Link>
    </main>
  );
}
