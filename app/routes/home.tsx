import { Form, Link } from "react-router";

import type { Route } from "./+types/home";
import { MODES, type Mode } from "../dashboard";
import { CategoryMark } from "../folder-tab";
import { getDashboard } from "../dashboard.server";
import { openWindow, openWindows } from "../emergency.server";
import { keys } from "../keys.server";
import { Masthead, Page, todayStamp } from "../masthead";
import { deliverNow, deliveryStatus } from "../notify.server";
import { reference } from "../reference";
import { confirmKeyCopy, readSafekeeping, type Safekeeping as SafekeepingState } from "../safekeeping.server";
import { withVault } from "../session.server";
import type { OwnerLink } from "../tree";
import { TreePicture, type MapTag } from "../tree-picture";
import { Segmented } from "../segmented";
import { longDate, When } from "../when";

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

  const needs = expiring.soon.length;
  // The tags are the same rows as Running out below, read through the
  // viewer's own transaction; an item whose owner they may not see has no id
  // and so no tag (D17), and stays in the list.
  const tags = new Map<string, MapTag[]>();
  for (const item of expiring.soon) {
    if (!item.ownerId) continue;
    const tag: MapTag = {
      tone: item.daysLeft < 0 ? "warn" : "soon",
      text: item.daysLeft < 0 ? `${item.title} expired` : item.daysLeft === 0 ? `${item.title} · today` : `${item.title} · ${item.daysLeft} days`,
    };
    tags.set(item.ownerId, [...(tags.get(item.ownerId) ?? []), tag]);
  }
  const owners = mode === "individuals" ? tree.households : [...tree.businesses, ...tree.households];
  // The household's own name when the viewer can see it; the page's otherwise.
  const title = tree.households[0]?.name ?? "Dashboard";

  return (
    <>
      <Masthead
        title={title}
        seed={title}
        serial={
          <>
            <span suppressHydrationWarning>{todayStamp()}</span> · {total} {mode === "businesses" ? "business" : "personal and household"} {total === 1 ? "paper" : "papers"}
          </>
        }
      >
        <Form method="get" action="/search" role="search" className="flex w-full gap-2 md:w-[26rem]">
          <label className="sr-only" htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            type="search"
            aria-keyshortcuts="/"
            placeholder="Search titles, people, or a document's number"
            className="field min-w-0 flex-1 border-transparent"
          />
          <button className="btn btn-serial" type="submit">Search</button>
        </Form>
      </Masthead>

      <Page>
        <p className="-mb-2 text-base text-gray-700">
          {needs === 0
            ? "Nothing needs you right now."
            : `${needs} ${needs === 1 ? "paper needs" : "papers need"} you.${expiring.soon.every((item) => item.ownerId) ? ` ${needs === 1 ? "It is" : "Each is"} stamped on whoever it belongs to.` : ""}`}
        </p>

        {user.role === "emergency" ? (
          <BreakGlass open={windows[0] ?? null} error={actionData && "error" in actionData ? (actionData.error ?? null) : null} />
        ) : null}

        {user.role === "admin" && windows.length > 0 ? (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {windows.map((w) => (
              <p key={w.id}>
                <span className="stamp stamp-warn mr-2">Emergency</span>
                <strong className="font-semibold">{w.name ?? "An emergency contact"}</strong> has an emergency window open
                until <When at={w.expiresAt} />.{w.reason ? <> They said: &ldquo;{w.reason}&rdquo;.</> : null}{" "}
                <Link className="underline" to={`/access?as=${w.userId}`}>Review or close it</Link>
              </p>
            ))}
          </div>
        ) : null}

        {delivery && (delivery.failing > 0 || delivery.stale) ? (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {delivery.failing > 0 ? (
              <p>
                {delivery.failing} notification{delivery.failing === 1 ? "" : "s"} could not be sent to your phone.{" "}
                <Link className="underline" to="/settings#notifications">See why</Link>
              </p>
            ) : null}
            {delivery.stale ? <p>Notifications have not been checked for over an hour. Restart Safehouse if this stays.</p> : null}
          </div>
        ) : null}

        {safekeeping ? <div className="order-2 md:order-none"><Safekeeping {...safekeeping} /></div> : null}

        <div className="order-3 flex flex-wrap items-center gap-x-5 gap-y-3 md:order-none">
          <Segmented
            label="Mode"
            options={MODES.map((m) => ({ to: m === "individuals" ? "/" : `/?mode=${m}`, label: MODE_LABEL[m], current: mode === m }))}
          />
          {chips.length > 0 ? (
            <ul aria-label="Quick searches" className="flex flex-wrap gap-2 text-sm">
              {chips.map((chip) => (
                <li key={chip.label}>
                  <Link
                    className="inline-flex items-baseline gap-2 rounded-sm border border-gray-300 bg-white px-2.5 py-1 hover:border-gray-600 pointer-coarse:py-2"
                    to={`/search?q=${encodeURIComponent(chip.label)}`}
                  >
                    {chip.label} <span className="font-mono text-xs text-gray-500">{chip.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <section aria-labelledby="family" className="sheet order-4 flex min-w-0 flex-col gap-4 p-4 md:order-none md:p-6">
            <div className="flex items-baseline justify-between gap-4 border-b border-gray-200 pb-3">
              <h2 id="family" className="text-lg font-semibold">
                {mode === "individuals" ? "The family" : "Businesses and the household"}
              </h2>
              {mode === "individuals" ? (
                <span className="text-xs text-gray-500">
                  <span className="font-mono">{tree.people.length}</span> {tree.people.length === 1 ? "person" : "people"}
                </span>
              ) : null}
            </div>
            {mode === "individuals" ? (
              tree.people.length > 0 ? (
                <TreePicture people={tree.people} edges={tree.edges} vaultFor={vaultFor} tags={tags} />
              ) : (
                <p className="text-sm text-gray-500">Nobody in the family tree that you can see.</p>
              )
            ) : null}
            <Owners owners={owners} empty={mode === "businesses" ? "No businesses that you can see." : null} vaultFor={vaultFor} tags={tags} />
          </section>

          <div className="order-1 grid items-start gap-8 md:order-none lg:grid-cols-2">
            <section aria-labelledby="running-out" className="sheet flex flex-col">
              <div className="flex items-baseline justify-between gap-4 border-b border-gray-900 px-4 pb-2 pt-4 md:px-5">
                <h2 id="running-out" className="text-lg font-semibold">Running out</h2>
                <span className="text-xs text-gray-500">
                  {expiring.leadDays ? <>next <span className="font-mono">{expiring.leadDays}</span> days</> : null}
                </span>
              </div>
              {expiring.soon.length === 0 ? (
                <p className="px-4 py-5 text-sm text-gray-500 md:px-5">
                  Nothing {mode === "businesses" ? "of the businesses' " : ""}confirmed to run out
                  {expiring.leadDays ? ` in the next ${expiring.leadDays} days` : ""}.
                </p>
              ) : (
                <ul className="text-sm">
                  {expiring.soon.map((item) => (
                    <li
                      key={item.documentId}
                      className="relative grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b border-gray-200 px-4 py-3 last:border-b-0 hover:bg-gray-50 md:px-5"
                    >
                      <Link className="row-link font-semibold" to={`/record/${item.documentId}`}>
                        {item.title}
                      </Link>
                      <span className="justify-self-end">
                        {item.daysLeft < 0 ? (
                          <span className="stamp stamp-warn" aria-label={when(item.daysLeft)}>Expired</span>
                        ) : (
                          <span className="stamp stamp-soon" aria-label={when(item.daysLeft)}>
                            {item.daysLeft === 0 ? "Today" : `${item.daysLeft} days`}
                          </span>
                        )}
                      </span>
                      <span className="text-gray-500">
                        {item.ownerName ?? "Owner not shown"} · <span className="ref">{reference(item.category, item.documentId)}</span>
                      </span>
                      <span className="justify-self-end font-mono text-xs text-gray-600">{longDate(item.expiresOn)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500 md:px-5">
                Dates somebody has confirmed. A date a reader proposed and nobody checked is not counted.
              </p>
            </section>

            <section aria-labelledby="by-kind" className="sheet flex flex-col">
              <div className="flex items-baseline justify-between gap-4 border-b border-gray-900 px-4 pb-2 pt-4 md:px-5">
                <h2 id="by-kind" className="text-lg font-semibold">By kind</h2>
                <span className="text-xs text-gray-500">
                  <span className="font-mono">{total}</span> {mode === "businesses" ? "business" : "personal and household"}
                </span>
              </div>
              <ul className="grid grid-cols-2 text-sm">
                {categories.map(({ category, count }) => (
                  <li key={category} className="border-b border-gray-200 odd:border-r [&:nth-last-child(-n+2)]:border-b-0">
                    {count > 0 ? (
                      <Link
                        className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-gray-50 md:px-5"
                        to={`/vault#${category}`}
                      >
                        <span className="flex items-center gap-2.5 capitalize">
                          <CategoryMark category={category} />
                          {category}
                        </span>
                        <span className="font-mono text-base font-medium">{count}</span>
                      </Link>
                    ) : (
                      <span className="flex items-center justify-between gap-2 px-4 py-3 text-gray-500 md:px-5">
                        <span className="flex items-center gap-2.5 capitalize">
                          <CategoryMark category={category} />
                          {category}
                        </span>
                        <span className="font-mono text-base">0</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500 md:px-5">Current versions you can see.</p>
            </section>
          </div>
      </Page>
    </>
  );
}

/**
 * The household and the businesses: papers that belong to no one person,
 * framed like a certificate rather than named like a person.
 */
function Owners({
  owners,
  empty,
  vaultFor,
  tags,
}: {
  owners: OwnerLink[];
  empty: string | null;
  vaultFor: (ownerId: string) => string;
  tags: Map<string, MapTag[]>;
}) {
  if (owners.length === 0) {
    return empty ? <p className="text-sm text-gray-500">{empty}</p> : null;
  }
  return (
    <ul aria-label="Papers that belong to no one person" className="flex flex-wrap gap-3 text-sm">
      {owners.map((owner) => (
        <li key={owner.ownerId}>
          <Link
            className="flex flex-col rounded-sm border-[3px] border-double border-gray-900 bg-white px-4 py-2.5 hover:border-accent"
            to={vaultFor(owner.ownerId)}
          >
            <span className="font-semibold">{owner.name}</span>
            <span className="text-xs text-gray-500">
              <span className="font-mono">{owner.papers}</span> {owner.papers === 1 ? "paper" : "papers"}
            </span>
            {(tags.get(owner.ownerId) ?? []).length > 0 ? (
              <span className="mt-2 flex flex-wrap gap-1.5">
                {tags.get(owner.ownerId)!.map((tag) => (
                  <span key={tag.text} className={`stamp ${tag.tone === "warn" ? "stamp-warn" : "stamp-soon"}`}>
                    {tag.text}
                  </span>
                ))}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BreakGlass({ open, error }: { open: { expiresAt: string } | null; error: string | null }) {
  if (open) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
        <span className="stamp stamp-warn mr-2">Window open</span>
        Your emergency window is open until <When at={open.expiresAt} />. You can see medical and
        legal papers until then. The administrator has been told, and every document you open is recorded.
      </div>
    );
  }
  return (
    <Form method="post" className="sheet flex flex-col gap-3 border-red-300 p-5 text-sm">
      <h2 className="text-lg font-semibold">Emergency access</h2>
      <p className="max-w-prose">
        Opening a window lets you see the household&apos;s medical and legal papers for a limited time. The
        administrator is told straight away, with the reason you give, and can close it.
      </p>
      <input type="hidden" name="intent" value="break-glass" />
      <label className="flex max-w-xl flex-col gap-1 font-medium">
        Why do you need it?
        <input name="reason" required minLength={3} maxLength={500} className="field font-normal" />
      </label>
      {error ? <p role="alert" className="text-red-700 dark:text-red-400">{error}</p> : null}
      <button type="submit" className="btn btn-danger self-start">Open an emergency window</button>
    </Form>
  );
}

/**
 * The two jobs that happen outside the app (D38), said until they are done.
 * Gold, not claret: nothing is wrong yet, which is the only time to fix it.
 */
function Safekeeping({ drilledBackupAt, drillOverdue, keyCopyConfirmed }: SafekeepingState) {
  if (!drillOverdue && keyCopyConfirmed) return null;
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      {drillOverdue ? (
        <p>
          {drilledBackupAt ? (
            <>The newest backup proven to restore was taken <When at={drilledBackupAt} />. </>
          ) : (
            <>No backup of this vault has been proven to restore. </>
          )}
          Run <code className="font-mono">npm run backup</code> and <code className="font-mono">npm run backup:drill</code> on the server, and schedule them
          weekly (docs/OPERATIONS.md).
        </p>
      ) : null}
      {keyCopyConfirmed ? null : (
        <Form method="post" className="flex flex-col gap-2">
          <p className="max-w-prose">
            Every document here is unreadable without the key file, and nothing else holds a copy of it: not the
            database, not a backup. If it is lost, the documents are gone and nobody can get them back. Write it down
            and keep it somewhere that is not this server.
          </p>
          <input type="hidden" name="intent" value="key-copied" />
          <button type="submit" className="btn btn-secondary btn-sm self-start">
            I have a copy of the key somewhere else
          </button>
        </Form>
      )}
    </div>
  );
}
