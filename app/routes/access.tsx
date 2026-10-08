import { Form, Link, useActionData, useNavigation } from "react-router";

import type { Route } from "./+types/access";
import {
  getMatrix,
  getPanel,
  setGrants,
  type GrantKind,
  type Panel,
  type RecordOption,
} from "../access.server";
import { CATEGORIES } from "../documents";
import { revokeWindows } from "../emergency.server";
import { withVault } from "../session.server";
import { resolveViewContext } from "../view-as.server";
import { When } from "../when";

export function meta() {
  return [{ title: "Access — Safehouse" }];
}

/**
 * How this surface enforces access.
 *
 * Admin only, refused here before anything is read: the panel and the matrix
 * both carry the admin's own reach as a denominator, and D34 says that number
 * goes to an admin or nobody. `resolveViewContext` already refuses a non-admin
 * any account but their own; `access.server.ts` checks the role again.
 *
 * Every number on the page is read through the policies, in the counted
 * account's own name, by the same mechanism as view-as (D21). Grants are
 * written through `withVault` as the admin, and `0012_grant_writes.sql`
 * refuses anybody else, so a hand-posted form from a member fails in the
 * database whatever this file does.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const view = await resolveViewContext(request);
  if (view.actor.role !== "admin") {
    throw new Response("Only an administrator can open the access console.", { status: 403 });
  }

  const roster = view.roster;
  if (new URL(request.url).searchParams.get("view") === "matrix") {
    return { roster, actorId: view.actor.id, matrix: await getMatrix(view.actor, roster), panel: null };
  }

  return {
    roster,
    actorId: view.actor.id,
    matrix: null,
    panel: view.isViewingAs ? await getPanel(view) : null,
  };
}

const KINDS: GrantKind[] = ["owner", "category", "record"];

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const userId = String(form.get("userId") ?? "");

  if (form.get("intent") === "revoke-window") {
    // `emergency_activations_revoke` (0015) is the check: an active admin, in
    // their own name. Anybody else closes nothing.
    const closed = await withVault(request, (db) => revokeWindows(db, userId));
    return closed > 0
      ? { kind: "window" as const, saved: closed }
      : { kind: "window" as const, error: "There was no open window to close." };
  }

  const kind = KINDS.find((k) => k === form.get("kind"));
  if (!kind) return { kind: null, error: "Nothing to save." };

  // Unchecked boxes are simply absent, so what arrives is the whole list as
  // the admin wants it, and the empty choice of the "add" select is dropped.
  const desired = form.getAll("value").map(String).filter(Boolean);

  try {
    const result = await withVault(request, (db) => setGrants(db, userId, kind, desired));
    return result.ok ? { kind, saved: result.changed } : { kind, error: result.problem };
  } catch (error) {
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "42501") return { kind, error: "Only the household administrator can change access." };
    if (code === "23503") return { kind, error: "That account, or what you picked, no longer exists." };
    throw error;
  }
}

const LABEL: Record<string, string> = {
  admin: "administrator",
  individual: "household member",
  third_party: "third party",
  emergency: "emergency contact",
};

export default function Access({ loaderData }: Route.ComponentProps) {
  const { roster, actorId, matrix, panel } = loaderData;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-medium tracking-tight">Access</h1>
        <nav className="flex gap-4 text-sm">
          <Link className={matrix ? "underline" : "font-medium"} to="/access">
            One account
          </Link>
          <Link className={matrix ? "font-medium" : "underline"} to="/access?view=matrix">
            Everyone at once
          </Link>
          <Link className="underline" to="/">
            Home
          </Link>
        </nav>
      </div>

      {matrix ? (
        <MatrixView matrix={matrix} />
      ) : (
        <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
          <nav aria-label="Accounts">
            <ul className="flex flex-col gap-1 text-sm">
              {roster.map((entry) => (
                <li key={entry.id}>
                  {entry.id === actorId ? (
                    <span className="text-gray-500">{entry.name} (you)</span>
                  ) : (
                    <Link
                      className={entry.id === panel?.subject.id ? "font-medium" : "underline decoration-gray-300"}
                      to={`/access?as=${entry.id}`}
                    >
                      {entry.name}
                    </Link>
                  )}
                  <span className="text-gray-500">
                    {" "}
                    · {LABEL[entry.role] ?? entry.role}
                    {entry.disabled ? ", disabled" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </nav>

          {panel ? (
            <PanelView key={panel.subject.id} panel={panel} />
          ) : (
            <p className="text-sm text-gray-500">
              Pick an account to see what it reaches and change what it is granted. Editing happens
              here, one person at a time; the grid of everyone is for checking, and is read-only.
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function PanelView({ panel }: { panel: Panel }) {
  const { subject, reach, reachable, reaches, grantable } = panel;

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-medium">{subject.name}</h2>
        <p className="text-sm text-gray-500">
          {LABEL[subject.role] ?? subject.role}
          {subject.disabled ? ", disabled: reaches nothing until re-enabled" : ""}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <meter className="h-3 w-full" min={0} max={Math.max(reachable, 1)} value={reach} />
        <p className="text-sm">
          {subject.name} reaches <strong className="font-medium">{reach} of the {reachable}</strong>{" "}
          documents you can see.{" "}
          <Link className="underline" to={`/vault?as=${subject.id}`}>
            See the vault as {subject.name}
          </Link>
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium">Owners they can see</h3>
        {reaches.length === 0 ? (
          <p className="mt-1 text-sm text-gray-500">Nobody&apos;s.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">
            {reaches.map((owner) => (
              <li key={owner.id} className="rounded border border-gray-200 px-2 py-0.5">
                {owner.name}
                {owner.granted ? <span className="text-gray-500"> · granted</span> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {subject.role === "individual"
            ? "Family comes from the tree and the household's own papers come with membership; neither is edited here. Private records stop at their owner."
            : subject.role === "third_party"
              ? "Both lists below have to agree: these owners, and these kinds of document. Private records need a grant of their own."
              : null}
        </p>
      </div>

      {panel.window ? <WindowNotice panel={panel} /> : null}

      {grantable.length === 0 ? (
        <p className="text-sm text-gray-500">
          {subject.role === "admin"
            ? "An administrator sees everything, private records included. There is nothing to grant."
            : subject.role === "emergency"
              ? "An emergency contact sees nothing until their window is opened, and then only medical and legal papers, until it expires. Grants do not apply."
              : "Nothing can be granted to this account."}
        </p>
      ) : (
        <>
          {grantable.includes("owner") && <OwnerGrants panel={panel} />}
          {grantable.includes("category") && <CategoryGrants panel={panel} />}
          {grantable.includes("record") && <RecordGrants panel={panel} />}
        </>
      )}
    </section>
  );
}

/** One form per list: what is ticked when it is saved is the list. */
function GrantForm({
  panel,
  kind,
  title,
  children,
}: {
  panel: Panel;
  kind: GrantKind;
  title: string;
  children: React.ReactNode;
}) {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formData?.get("kind") === kind;
  const mine = result && result.kind === kind ? result : null;

  return (
    <Form method="post" className="flex flex-col gap-2 rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <input type="hidden" name="userId" value={panel.subject.id} />
      <input type="hidden" name="kind" value={kind} />
      {children}
      <div className="flex items-center gap-3">
        <button className="rounded border border-gray-300 px-3 py-1 text-sm" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        {mine && "error" in mine && mine.error ? <span className="text-sm text-red-700">{mine.error}</span> : null}
        {mine && "saved" in mine ? (
          <span className="text-sm text-gray-500">
            {mine.saved === 0 ? "Nothing changed." : `Saved, ${mine.saved} ${mine.saved === 1 ? "change" : "changes"} logged.`}
          </span>
        ) : null}
      </div>
    </Form>
  );
}

function OwnerGrants({ panel }: { panel: Panel }) {
  const granted = new Set(panel.grants.owners);
  return (
    <GrantForm panel={panel} kind="owner" title="Owners granted by hand">
      <div className="grid gap-1 text-sm sm:grid-cols-2">
        {panel.options.owners.map((owner) => (
          <label key={owner.id} className="flex items-center gap-2">
            <input type="checkbox" name="value" value={owner.id} defaultChecked={granted.has(owner.id)} />
            {owner.name}
            {owner.kind !== "person" ? <span className="text-gray-500">({owner.kind})</span> : null}
          </label>
        ))}
      </div>
    </GrantForm>
  );
}

function CategoryGrants({ panel }: { panel: Panel }) {
  const granted = new Set<string>(panel.grants.categories);
  return (
    <GrantForm panel={panel} kind="category" title="Kinds of document">
      <div className="flex flex-wrap gap-4 text-sm">
        {CATEGORIES.map((category) => (
          <label key={category} className="flex items-center gap-2 capitalize">
            <input type="checkbox" name="value" value={category} defaultChecked={granted.has(category)} />
            {category}
          </label>
        ))}
      </div>
    </GrantForm>
  );
}

function recordLabel(record: RecordOption): string {
  return `${record.title} — ${record.ownerName} (${record.category}${record.isPrivate ? ", private" : ""})`;
}

function RecordGrants({ panel }: { panel: Panel }) {
  const granted = new Set(panel.grants.records.map((r) => r.id));
  return (
    <GrantForm panel={panel} kind="record" title="Single records">
      {panel.grants.records.length === 0 ? (
        <p className="text-sm text-gray-500">None. A private record is reachable only this way.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {panel.grants.records.map((record) => (
            <li key={record.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="value" value={record.id} defaultChecked />
                {recordLabel(record)}
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Add one</span>
        <select name="value" defaultValue="" className="rounded border border-gray-300 p-1">
          <option value="">—</option>
          {panel.options.records
            .filter((record) => !granted.has(record.id))
            .map((record) => (
              <option key={record.id} value={record.id}>
                {recordLabel(record)}
              </option>
            ))}
        </select>
      </label>
    </GrantForm>
  );
}

function MatrixView({ matrix }: { matrix: NonNullable<Route.ComponentProps["loaderData"]["matrix"]> }) {
  const cell = (n: number | undefined) => (n ? String(n) : "·");
  // Every cell opens its row's panel (D21). Out of the tab order, so the
  // keyboard gets one stop per account, on its name, rather than twenty.

  return (
    <section className="flex flex-col gap-2">
      <p className="text-sm text-gray-500">
        Documents each account reaches, by whose they are and by kind, read as that account. Read-only:
        click a row to change it.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left align-bottom">
              <th className="p-2 font-medium">Account</th>
              <th className="p-2 font-medium">Reaches</th>
              {matrix.owners.map((owner) => (
                <th key={owner.id} className="p-2 font-normal text-gray-500">
                  {owner.name}
                </th>
              ))}
              {CATEGORIES.map((category) => (
                <th key={category} className="p-2 font-normal capitalize text-gray-500">
                  {category}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.user.id} className="border-b border-gray-100">
                <th className="p-2 text-left font-normal">
                  <Link className="whitespace-nowrap underline decoration-gray-300" to={`/access?as=${row.user.id}`}>
                    {row.user.name}
                  </Link>
                  <span className="block text-xs text-gray-500">{LABEL[row.user.role] ?? row.user.role}</span>
                </th>
                <td className="whitespace-nowrap p-2">
                  {row.total} of {matrix.reachable}
                </td>
                {matrix.owners.map((owner) => (
                  <td key={owner.id} className="p-2 text-center">
                    <Link tabIndex={-1} to={`/access?as=${row.user.id}`}>{cell(row.byOwner[owner.id])}</Link>
                  </td>
                ))}
                {CATEGORIES.map((category) => (
                  <td key={category} className="p-2 text-center">
                    <Link tabIndex={-1} to={`/access?as=${row.user.id}`}>{cell(row.byCategory[category])}</Link>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        &ldquo;Of {matrix.reachable}&rdquo; is what you can see yourself, not a count of the database.
      </p>
    </section>
  );
}

function WindowNotice({ panel }: { panel: Panel }) {
  const result = useActionData<typeof action>();
  const window = panel.window!;
  return (
    <Form method="post" className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
      <p>
        Emergency window open until <When at={window.expiresAt} />.
        {window.reason ? <> They said: &ldquo;{window.reason}&rdquo;.</> : null}
      </p>
      <input type="hidden" name="intent" value="revoke-window" />
      <input type="hidden" name="userId" value={panel.subject.id} />
      <button type="submit" className="self-start rounded-lg bg-red-700 px-3 py-1.5 text-white">Close it now</button>
      {result && result.kind === "window" && "error" in result ? <p>{result.error}</p> : null}
    </Form>
  );
}
