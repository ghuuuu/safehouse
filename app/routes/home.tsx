import { Form, Link } from "react-router";

import type { Route } from "./+types/home";
import { MODES, type Mode } from "../dashboard";
import { getDashboard } from "../dashboard.server";
import { withVault } from "../session.server";
import type { OwnerLink } from "../tree";
import { TreePicture } from "../tree-picture";

export function meta() {
  return [{ title: "Safehouse" }];
}

/**
 * How this surface enforces access: it does not.
 *
 * Everything on the dashboard comes from `getDashboard` inside `withVault`,
 * which runs as `safehouse_app` in a transaction that names the signed-in user.
 * The policies decide what is counted, drawn and listed; there is no filtering
 * here to get wrong, and a signed-out request never reaches the query —
 * `withVault` throws a redirect first. The mode switch only chooses which of
 * the viewer's own documents to show.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const asked = new URL(request.url).searchParams.get("mode");
  const mode: Mode = MODES.find((m) => m === asked) ?? "individuals";

  return withVault(request, async (db, user) => ({
    user,
    mode,
    dashboard: await getDashboard(db, mode),
  }));
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

const MODE_LABEL: Record<Mode, string> = { individuals: "Individuals", businesses: "Businesses" };

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, mode, dashboard } = loaderData;
  const { tree, expiring, categories, chips } = dashboard;
  const vaultFor = (ownerId: string) => `/vault?owner=${ownerId}`;
  const total = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 p-8">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Safehouse</h1>
          <p className="mt-1 text-sm text-gray-500">
            Signed in as {user.name} ({user.role}).
          </p>
        </div>
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link className="underline" to="/vault">Vault</Link>
          <Link className="underline" to="/search">Search</Link>
          <Link className="underline" to="/people">People</Link>
          <Link className="underline" to="/tree">Family tree</Link>
          <Link className="underline" to="/upload">File a document</Link>
          <Link className="underline" to="/bulk">File many</Link>
          {user.role === "admin" && (
            <Link className="underline" to="/access">Access</Link>
          )}
          <Form method="post" action="/sign-out">
            <button className="text-gray-500 underline" type="submit">Sign out</button>
          </Form>
        </nav>
      </header>

      <nav aria-label="Mode" className="flex w-fit rounded-lg border border-gray-200 p-1 text-sm">
        {MODES.map((m) => (
          <Link
            key={m}
            to={m === "individuals" ? "/" : `/?mode=${m}`}
            aria-current={mode === m ? "page" : undefined}
            className={
              mode === m
                ? "rounded-md bg-gray-900 px-4 py-1.5 text-white dark:bg-gray-100 dark:text-gray-900"
                : "rounded-md px-4 py-1.5 text-gray-600"
            }
          >
            {MODE_LABEL[m]}
          </Link>
        ))}
      </nav>

      <Form method="get" action="/search" role="search" className="flex flex-col gap-2">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            type="search"
            placeholder="Search titles, people, kinds — or a document's number"
            className="flex-1 rounded border border-gray-300 p-2 text-sm"
          />
          <button className="rounded border border-gray-300 px-4 text-sm" type="submit">Search</button>
        </div>
        {chips.length > 0 ? (
          <ul aria-label="Quick searches" className="flex flex-wrap gap-2 text-sm">
            {chips.map((chip) => (
              <li key={chip.label}>
                <Link
                  className="rounded-full border border-gray-200 px-3 py-1 hover:border-gray-400"
                  to={`/search?q=${encodeURIComponent(chip.label)}`}
                >
                  {chip.label} <span className="text-gray-500">{chip.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Form>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          {mode === "individuals" ? "The family" : "Businesses"}
        </h2>
        {mode === "individuals" ? (
          tree.people.length > 0 ? (
            <TreePicture people={tree.people} edges={tree.edges} vaultFor={vaultFor} />
          ) : (
            <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
              Nobody in the family tree that you can see.
            </p>
          )
        ) : (
          <Owners owners={tree.businesses} empty="No businesses that you can see." vaultFor={vaultFor} />
        )}
        {mode === "individuals" && tree.households.length > 0 ? (
          <p className="text-sm">
            Household papers:{" "}
            {tree.households.map((h) => (
              <Link key={h.ownerId} className="underline" to={vaultFor(h.ownerId)}>{h.name}</Link>
            ))}
          </p>
        ) : null}
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Running out</h2>
          {expiring.soon.length === 0 ? (
            <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
              Nothing {mode === "businesses" ? "of the businesses' " : ""}confirmed to run out
              {expiring.leadDays ? ` in the next ${expiring.leadDays} days` : ""}.
            </p>
          ) : (
            <ul className="rounded-lg border border-gray-200 text-sm">
              {expiring.soon.map((item) => (
                <li
                  key={item.documentId}
                  className="flex items-baseline justify-between gap-4 border-b border-gray-100 p-4 last:border-b-0"
                >
                  <Link className="underline decoration-gray-300" to={`/record/${item.documentId}`}>
                    {item.title}
                    {item.ownerName ? ` — ${item.ownerName}` : ""}
                  </Link>
                  <span className={item.daysLeft < 0 ? "text-red-700" : "text-gray-500"}>
                    {when(item.daysLeft)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500">
            Dates somebody has confirmed. A date a reader proposed and nobody checked is not counted.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">
            {total} {total === 1 ? "document" : "documents"} by kind
          </h2>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {categories.map(({ category, count }) => (
              <li key={category}>
                {count > 0 ? (
                  <Link
                    className="flex items-baseline justify-between rounded-lg border border-gray-200 p-3 hover:border-gray-400"
                    to={`/vault#${category}`}
                  >
                    <span className="capitalize">{category}</span>
                    <span className="text-gray-500">{count}</span>
                  </Link>
                ) : (
                  <span className="flex items-baseline justify-between rounded-lg border border-dashed border-gray-200 p-3 text-gray-400">
                    <span className="capitalize">{category}</span>
                    <span>0</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">
            Current versions you can see. Counted by the database, not by this page.
          </p>
        </section>
      </div>
    </main>
  );
}

function Owners({
  owners,
  empty,
  vaultFor,
}: {
  owners: OwnerLink[];
  empty: string;
  vaultFor: (ownerId: string) => string;
}) {
  if (owners.length === 0) {
    return <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500">{empty}</p>;
  }
  return (
    <ul className="rounded-lg border border-gray-200 text-sm">
      {owners.map((owner) => (
        <li key={owner.ownerId} className="border-b border-gray-100 p-4 last:border-b-0">
          <Link className="underline" to={vaultFor(owner.ownerId)}>{owner.name}</Link>
        </li>
      ))}
    </ul>
  );
}
