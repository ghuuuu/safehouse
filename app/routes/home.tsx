import { Form, Link } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/home";
import { findExpiring } from "../expiry.server";
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
 *
 * The expiry list is the same story at one more remove: `findExpiring` reads
 * `documents` through the ordinary policies, so a document this viewer cannot
 * open cannot appear in it (D30).
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

    return { user, counts, expiring: await findExpiring(db) };
  });
}

/** "in 12 days", "today", "40 days ago" — the only thing worth reading twice. */
function when(daysLeft: number): string {
  if (daysLeft === 0) return "expires today";
  if (daysLeft < 0) {
    const ago = Math.abs(daysLeft);
    return `expired ${ago} ${ago === 1 ? "day" : "days"} ago`;
  }
  return `expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, counts, expiring } = loaderData;

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

      {expiring.soon.length > 0 && (
        <section>
          <h2 className="text-sm font-medium">Running out</h2>
          <ul className="mt-2 rounded-lg border border-gray-200 text-sm">
            {expiring.soon.map((item) => (
              <li
                key={item.documentId}
                className="flex items-baseline justify-between gap-4 border-b border-gray-100 p-4 last:border-b-0"
              >
                <Link
                  className="underline decoration-gray-300"
                  to={`/record/${item.documentId}`}
                >
                  {item.title}
                  {item.ownerName ? ` — ${item.ownerName}` : ""}
                </Link>
                <span
                  className={
                    item.daysLeft < 0 ? "text-red-700" : "text-gray-500"
                  }
                >
                  {when(item.daysLeft)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            Dates somebody has confirmed, within the next {expiring.leadDays}{" "}
            days. A date a reader proposed and nobody checked is not counted.
          </p>
        </section>
      )}

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
