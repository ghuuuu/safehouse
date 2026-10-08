import { Form, Link } from "react-router";

import type { Route } from "./+types/home";
import { MODES, type Mode } from "../dashboard";
import { CategoryMark } from "../folder-tab";
import { getDashboard } from "../dashboard.server";
import { openWindow, openWindows } from "../emergency.server";
import { keys } from "../keys.server";
import { deliverNow, deliveryStatus } from "../notify.server";
import { confirmKeyCopy, readSafekeeping, type Safekeeping as SafekeepingState } from "../safekeeping.server";
import { withVault } from "../session.server";
import type { OwnerLink } from "../tree";
import { TreePicture } from "../tree-picture";
import { Segmented } from "../segmented";
import { When } from "../when";

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
    // Open break-glass windows: an admin sees everybody's, a contact their own.
    windows: await openWindows(db),
    delivery: user.role === "admin" ? await deliveryStatus(db) : null,
    safekeeping: user.role === "admin" ? await readSafekeeping(db, keyIdHex()) : null,
  }));
}

const keyIdHex = () => keys().keyId().toString("hex");

/**
 * Breaking the glass (D19). Only an emergency contact gets the form, and only
 * the policy in 0015 decides whether the window opens; the database alerts the
 * admins in the same transaction, and the alert is pushed out at once.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();

  // The admin's word that the key is written down off this machine (D38).
  // Settings' update policy is what refuses anybody else.
  if (form.get("intent") === "key-copied") {
    await withVault(request, (db) => confirmKeyCopy(db, keyIdHex()));
    return { keyCopied: true };
  }

  if (form.get("intent") !== "break-glass") return { error: "Nothing to do." };

  try {
    const result = await withVault(request, (db) => openWindow(db, String(form.get("reason") ?? "")));
    if (!result.ok) return { error: result.problem };
  } catch (error) {
    if ((error as { cause?: { code?: string } })?.cause?.code === "42501") {
      return { error: "Only an emergency contact can open an emergency window." };
    }
    throw error;
  }

  deliverNow();
  return { opened: true };
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

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { user, mode, dashboard, windows, delivery, safekeeping } = loaderData;
  const { tree, expiring, categories, chips } = dashboard;
  const vaultFor = (ownerId: string) => `/vault?owner=${ownerId}`;
  const total = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-6 md:p-8">
      <h1 className="text-2xl font-medium tracking-tight">Dashboard</h1>

      {user.role === "emergency" ? (
        <BreakGlass open={windows[0] ?? null} error={actionData && "error" in actionData ? (actionData.error ?? null) : null} />
      ) : null}

      {user.role === "admin" && windows.length > 0 ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          {windows.map((w) => (
            <p key={w.id}>
              <strong className="font-medium">{w.name ?? "An emergency contact"}</strong> has an emergency window open
              until <When at={w.expiresAt} />.{w.reason ? <> They said: &ldquo;{w.reason}&rdquo;.</> : null}{" "}
              <Link className="underline" to={`/access?as=${w.userId}`}>Review or close it</Link>
            </p>
          ))}
        </div>
      ) : null}

      {delivery && (delivery.failing > 0 || delivery.stale) ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {delivery.failing > 0 ? (
            <p>
              {delivery.failing} notification{delivery.failing === 1 ? "" : "s"} could not be sent to your phone.{" "}
              <Link className="underline" to="/settings#notifications">See why</Link>
            </p>
          ) : null}
          {delivery.stale ? <p>Notifications have not been checked for over an hour. Restart Safehouse if this stays.</p> : null}
        </div>
      ) : null}

      {safekeeping ? <Safekeeping {...safekeeping} /> : null}

      <Segmented
        label="Mode"
        options={MODES.map((m) => ({ to: m === "individuals" ? "/" : `/?mode=${m}`, label: MODE_LABEL[m], current: mode === m }))}
      />

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
                  className="inline-block rounded-full border border-gray-200 px-3 py-1 hover:border-gray-400 pointer-coarse:py-2"
                  to={`/search?q=${encodeURIComponent(chip.label)}`}
                >
                  {chip.label} <span className="text-gray-500">{chip.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Form>

      <div className="grid gap-8 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Running out</h2>
          {expiring.soon.length === 0 ? (
            <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
              Nothing {mode === "businesses" ? "of the businesses' " : ""}confirmed to run out
              {expiring.leadDays ? ` in the next ${expiring.leadDays} days` : ""}.
            </p>
          ) : (
            <ul className="rounded-lg border border-gray-200 bg-white text-sm">
              {expiring.soon.map((item) => (
                <li
                  key={item.documentId}
                  className="relative flex items-baseline justify-between gap-4 border-b border-gray-100 p-4 last:border-b-0"
                >
                  <Link className="row-link underline decoration-gray-300" to={`/record/${item.documentId}`}>
                    {item.title}
                    {item.ownerName ? ` — ${item.ownerName}` : ""}
                  </Link>
                  <span className={item.daysLeft < 0 ? "text-red-700 dark:text-red-400" : "text-gray-500"}>
                    {when(item.daysLeft)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500 max-w-prose">
            Dates somebody has confirmed. A date a reader proposed and nobody checked is not counted.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">
            {total} {mode === "businesses" ? "business" : "personal and household"}{" "}
            {total === 1 ? "document" : "documents"} by kind
          </h2>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {categories.map(({ category, count }) => (
              <li key={category}>
                {count > 0 ? (
                  <Link
                    className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3 hover:border-gray-400"
                    to={`/vault#${category}`}
                  >
                    <span className="flex items-center gap-2 capitalize">
                      <CategoryMark category={category} />
                      {category}
                    </span>
                    <span className="text-gray-500">{count}</span>
                  </Link>
                ) : (
                  <span className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 p-3 text-gray-500">
                    <span className="flex items-center gap-2 capitalize">
                      <CategoryMark category={category} />
                      {category}
                    </span>
                    <span>0</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 max-w-prose">
            Current versions you can see; the vault also lists older ones.
          </p>
        </section>
      </div>

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
    <ul className="rounded-lg border border-gray-200 bg-white text-sm">
      {owners.map((owner) => (
        <li key={owner.ownerId} className="border-b border-gray-100 p-4 last:border-b-0">
          <Link className="underline" to={vaultFor(owner.ownerId)}>{owner.name}</Link>
        </li>
      ))}
    </ul>
  );
}

function BreakGlass({ open, error }: { open: { expiresAt: string } | null; error: string | null }) {
  if (open) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
        Your emergency window is open until <When at={open.expiresAt} />. You can see medical and
        legal papers until then. The administrator has been told, and every document you open is recorded.
      </div>
    );
  }
  return (
    <Form method="post" className="flex flex-col gap-3 rounded-lg border border-red-300 p-4 text-sm">
      <h2 className="font-medium">Emergency access</h2>
      <p>
        Opening a window lets you see the household&apos;s medical and legal papers for a limited time. The
        administrator is told straight away, with the reason you give, and can close it.
      </p>
      <input type="hidden" name="intent" value="break-glass" />
      <label className="flex flex-col gap-1">
        Why do you need it?
        <input name="reason" required minLength={3} maxLength={500} className="rounded border border-gray-300 p-2" />
      </label>
      {error ? <p role="alert" className="text-red-700 dark:text-red-400">{error}</p> : null}
      <button type="submit" className="self-start rounded-lg bg-red-700 px-4 py-2 text-red-50">Open an emergency window</button>
    </Form>
  );
}

/**
 * The two jobs that happen outside the app (D38), said until they are done.
 * Amber, not red: nothing is wrong yet, which is the only time to fix it.
 */
function Safekeeping({ drilledBackupAt, drillOverdue, keyCopyConfirmed }: SafekeepingState) {
  if (!drillOverdue && keyCopyConfirmed) return null;
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      {drillOverdue ? (
        <p>
          {drilledBackupAt ? (
            <>The newest backup proven to restore was taken <When at={drilledBackupAt} />. </>
          ) : (
            <>No backup of this vault has been proven to restore. </>
          )}
          Run <code>npm run backup</code> and <code>npm run backup:drill</code> on the server, and schedule them
          weekly (docs/OPERATIONS.md).
        </p>
      ) : null}
      {keyCopyConfirmed ? null : (
        <Form method="post" className="flex flex-col gap-2">
          <p>
            Every document here is unreadable without the key file, and nothing else holds a copy of it: not the
            database, not a backup. If it is lost, the documents are gone and nobody can get them back. Write it down
            and keep it somewhere that is not this server.
          </p>
          <input type="hidden" name="intent" value="key-copied" />
          <button type="submit" className="self-start rounded-lg border border-amber-400 px-3 py-1">
            I have a copy of the key somewhere else
          </button>
        </Form>
      )}
    </div>
  );
}
