import { Form, redirect } from "react-router";

import type { Route } from "./+types/setup";
import { auth, noUsersYet } from "../auth.server";

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-6 md:p-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Safehouse</h1>
        <p className="mt-1 text-sm text-gray-500">
          This account will be the administrator. It can see every record in the
          household, including the private ones, and it is the only account that
          can create the others.
        </p>
      </div>

      <Form method="post" className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Name</span>
          <input
            className="rounded-lg border border-gray-300 p-2"
            name="name"
            required
          />
        </label>

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
            autoComplete="new-password"
            minLength={12}
            required
          />
          <span className="text-xs text-gray-500">
            At least 12 characters. Nothing here can email you a reset link, so
            put it somewhere you will find it again.
          </span>
        </label>

        {actionData?.error ? (
          <p className="text-sm text-red-700 dark:text-red-400">{actionData.error}</p>
        ) : null}

        <button
          className="rounded-lg bg-gray-900 p-2 text-sm text-white"
          type="submit"
        >
          Create the administrator
        </button>
      </Form>
    </main>
  );
}
