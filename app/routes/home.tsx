import type { Route } from "./+types/home";

import { checkDatabase } from "../db.server";

export function meta() {
  return [{ title: "Safehouse" }];
}

export async function loader() {
  const status = await checkDatabase();

  return {
    database: status.ok ? ("connected" as const) : ("unavailable" as const),
    // The reason belongs to whoever runs the server, not to the browser.
    // Sending it in production would be a habit worth not starting (D1).
    detail: !status.ok && import.meta.env.DEV ? status.error : null,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const connected = loaderData.database === "connected";

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Safehouse</h1>
        <p className="mt-1 text-sm text-gray-500">
          Scaffold. No vault, no documents, no accounts yet.
        </p>
      </div>

      <dl className="rounded-lg border border-gray-200 text-sm">
        <div className="flex items-center justify-between gap-4 p-4">
          <dt className="text-gray-500">Database</dt>
          <dd className={connected ? "text-green-700" : "text-red-700"}>
            {loaderData.database}
          </dd>
        </div>
      </dl>

      {loaderData.detail ? (
        <pre className="overflow-x-auto rounded-lg bg-gray-50 p-4 text-xs text-gray-600">
          {loaderData.detail}
        </pre>
      ) : null}
    </main>
  );
}
