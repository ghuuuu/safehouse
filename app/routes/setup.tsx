import { Form, redirect } from "react-router";

import type { Route } from "./+types/setup";
import { auth, noUsersYet } from "../auth.server";
import { SignedOut } from "../signed-out";

export function meta() {
  return [{ title: "First run — Safehouse" }];
}

/**
 * Creating the household administrator, once.
 *
 * This page works only while the vault has no accounts at all. After that both
 * the loader and the sign-up gate in auth.server.ts refuse it, so it cannot
 * become a second way in — the check is repeated because the two halves fail
 * differently, and one of them going missing should not open the door.
 */
export async function loader() {
  if (!(await noUsersYet())) throw redirect("/sign-in");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  if (!(await noUsersYet())) throw redirect("/sign-in");

  const form = await request.formData();
  const password = String(form.get("password") ?? "");

  if (password.length < 12) {
    return { error: "Use at least 12 characters." };
  }

  const response = await auth.api.signUpEmail({
    body: {
      email: String(form.get("email") ?? ""),
      name: String(form.get("name") ?? ""),
      password,
    },
    headers: request.headers,
    asResponse: true,
  });

  if (!response.ok) {
    return { error: "That account could not be created." };
  }

  const cookie = response.headers.get("set-cookie");
  return redirect("/", cookie ? { headers: { "set-cookie": cookie } } : {});
}

export default function Setup({ actionData }: Route.ComponentProps) {
  return (
    <SignedOut title="First run">
      <p className="-mt-4 text-sm text-gray-500 max-w-prose">
        This account will be the administrator. It can see every record in the
        household, including the private ones, and it is the only account that
        can create the others.
      </p>

      <Form method="post" className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Name
          <input
            className="field font-normal"
            name="name"
            required
          />
        </label>

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
            autoComplete="new-password"
            minLength={12}
            required
          />
          <span className="text-xs font-normal text-gray-500">
            At least 12 characters. Nothing here can email you a reset link, so
            put it somewhere you will find it again.
          </span>
        </label>

        {actionData?.error ? (
          <p className="text-sm text-red-700 dark:text-red-400">{actionData.error}</p>
        ) : null}

        <button className="btn btn-primary w-full" type="submit">
          Create the administrator
        </button>
      </Form>
    </SignedOut>
  );
}
