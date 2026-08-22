import { Form } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/home";
import { withVault } from "../session.server";

export function meta() {
  return [{ title: "Safehouse" }];
}

/**
 * How this surface enforces access: it does not.
 *
 * Every number below comes from a plain `count(*)` inside `withVault`, which
 * runs as `safehouse_app` in a transaction that names the signed-in user. The
 * policies in 0001_permission_layer.sql decide what is counted. There is no
 * filtering here to get wrong, and a signed-out request never reaches the
 * query — `withVault` throws a redirect first.
 */
export async function loader({ request }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    const [counts] = await db.execute<{
      owners: number;
      records: number;
      documents: number;
    }>(sql`
      select
        (select count(*) from owners)::int as owners,
        (select count(*) from records)::int as records,
        (select count(*) from documents)::int as documents
    `);

    return { user, counts };
  });
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, counts } = loaderData;

  const rows = [
    ["People and businesses", counts.owners],
    ["Records", counts.records],
    ["Documents", counts.documents],
  ] as const;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Safehouse</h1>
        <p className="mt-1 text-sm text-gray-500">
          Signed in as {user.name} ({user.role}).
        </p>
      </div>

      <dl className="rounded-lg border border-gray-200 text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 border-b border-gray-100 p-4 last:border-b-0"
          >
            <dt className="text-gray-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-sm text-gray-500">
        These are the counts you are entitled to, resolved by the database
        rather than by this page.
      </p>

      <Form method="post" action="/sign-out">
        <button className="text-sm text-gray-500 underline" type="submit">
          Sign out
        </button>
      </Form>
    </main>
  );
}
