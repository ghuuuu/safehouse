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
import { Masthead, Page } from "../masthead";
import { roleLabel } from "../roles";
import { Segmented } from "../segmented";
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

  // The lists the panel showed, and only those: an account offered no record
  // grants keeps whatever it has rather than losing them to an absent list.
  const kinds = KINDS.filter((k) => form.getAll("kind").includes(k));
  if (kinds.length === 0) return { kind: "grants" as const, error: "Nothing to save." };

  try {
    // One transaction for every list, so a refusal in one undoes the others
    // rather than keeping half of what the admin pressed Save on.
    const saved = await withVault(request, async (db) => {
      let changed = 0;
      for (const kind of kinds) {
        // Unchecked boxes are simply absent, so what arrives is the whole list
        // as the admin wants it, and the empty choice of "add one" is dropped.
        const desired = form.getAll(kind).map(String).filter(Boolean);
        const result = await setGrants(db, userId, kind, desired);
        if (!result.ok) throw new GrantProblem(result.problem);
        changed += result.changed;
      }
      return changed;
    });
    return { kind: "grants" as const, saved };
  } catch (error) {
    if (error instanceof GrantProblem) return { kind: "grants" as const, error: error.message };
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "42501") return { kind: "grants" as const, error: "Only the household administrator can change access." };
    if (code === "23503") return { kind: "grants" as const, error: "That account, or what you picked, no longer exists." };
    throw error;
  }
}

class GrantProblem extends Error {}

export default function Access({ loaderData }: Route.ComponentProps) {
  const { roster, actorId, matrix, panel } = loaderData;

  return (
    <>
      <Masthead
        title="Access"
        serial={
          panel ? (
            <>Viewing {panel.subject.name}</>
          ) : (
            <>
              {roster.length} {roster.length === 1 ? "account" : "accounts"}
            </>
          )
        }
      />

      <Page>
        <Segmented
          label="View"
          options={[
            { to: "/access", label: "One account", current: !matrix },
            { to: "/access?view=matrix", label: "Everyone at once", current: !!matrix },
          ]}
        />

      {matrix ? (
        <MatrixView matrix={matrix} />
      ) : (
        // minmax(0, 1fr): a long record name in "Add one" must not widen the
        // column past the screen.
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Accounts" className="sheet">
            <p className="index border-b border-gray-900 px-4 pb-2 pt-4 text-gray-500">Accounts</p>
            <ul className="flex flex-col text-sm">
              {roster.map((entry) => (
                <li
                  key={entry.id}
                  className={
                    "relative border-b border-gray-200 px-4 py-3 last:border-b-0 " +
                    (entry.id === panel?.subject.id ? "bg-gray-100" : "hover:bg-gray-50")
                  }
                >
                  {entry.id === actorId ? (
                    <span className="text-gray-500">{entry.name} (you)</span>
                  ) : (
                    <Link
                      className={"row-link " + (entry.id === panel?.subject.id ? "font-semibold" : "font-medium")}
                      to={`/access?as=${entry.id}`}
                    >
                      {entry.name}
                    </Link>
                  )}
                  <span className="block text-xs text-gray-500">
                    {roleLabel(entry.role)}
                    {entry.disabled ? ", disabled" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </nav>

          {panel ? (
            // On a phone, the chosen account comes first and the list after it.
            <div className="order-first md:order-none">
              <PanelView key={panel.subject.id} panel={panel} />
            </div>
          ) : (
            <p className="sheet max-w-prose p-5 text-sm text-gray-500">
              Pick an account to see what it reaches and change what it is granted. Editing happens
              here, one person at a time; the grid of everyone is for checking, and is read-only.
            </p>
          )}
        </div>
      )}
      </Page>
    </>
  );
}

function PanelView({ panel }: { panel: Panel }) {
  const { subject, reach, reachable, reaches, grantable } = panel;

  return (
    <section className="sheet flex flex-col gap-6 p-4 md:p-6">
      <div className="border-b border-gray-900 pb-2">
        <h2 className="text-lg font-semibold">{subject.name}</h2>
        <p className="text-sm text-gray-500 max-w-prose">
          {roleLabel(subject.role)}
          {subject.disabled ? ", disabled: reaches nothing until re-enabled" : ""}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {/* The sentence below says the numbers; this bar only shows them. */}
        <div aria-hidden className="h-2 border border-gray-300 bg-white">
          <div className="h-full bg-accent" style={{ width: `${(reach / Math.max(reachable, 1)) * 100}%` }} />
        </div>
        <p className="text-sm">
          {subject.name} reaches <strong className="font-semibold"><span className="font-mono">{reach}</span> of the <span className="font-mono">{reachable}</span></strong>{" "}
          documents you can see.{" "}
          <Link className="underline" to={`/vault?as=${subject.id}`}>
            See the vault as {subject.name}
          </Link>
        </p>
      </div>

      <div>
        <h3 className="index text-gray-500">Owners they can see</h3>
        {reaches.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500 max-w-prose">Nobody&apos;s.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {reaches.map((owner) => (
              <li key={owner.id} className="rounded-sm border border-gray-300 bg-white px-2.5 py-1">
                {owner.name}
                {owner.granted ? <span className="text-gray-500"> · granted</span> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-500 max-w-prose">
          {subject.role === "individual"
            ? "Family comes from the tree and the household's own papers come with membership; neither is edited here. Private records stop at their owner."
            : subject.role === "third_party"
              ? "Both lists below have to agree: these owners, and these kinds of document. Private records need a grant of their own."
              : null}
        </p>
      </div>

      {panel.window ? <WindowNotice panel={panel} /> : null}

      {grantable.length === 0 ? (
        <p className="text-sm text-gray-500 max-w-prose">
          {subject.role === "admin"
            ? "An administrator sees everything, private records included. There is nothing to grant."
            : subject.role === "emergency"
              ? "An emergency contact sees nothing until their window is opened, and then only medical and legal papers, until it expires. Grants do not apply."
              : "Nothing can be granted to this account."}
        </p>
      ) : (
        <GrantForm panel={panel}>
          {grantable.includes("owner") && <OwnerGrants panel={panel} />}
          {grantable.includes("category") && <CategoryGrants panel={panel} />}
          {grantable.includes("record") && <RecordGrants panel={panel} />}
        </GrantForm>
      )}
    </section>
  );
}

/**
 * One form and one Save: what is ticked in every list when it is saved is the
 * account's access. A Save per list lost a tick in one list to a press of
 * another list's button.
 */
function GrantForm({ panel, children }: { panel: Panel; children: React.ReactNode }) {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formData?.has("kind") === true;
  const mine = result && result.kind === "grants" ? result : null;

  return (
    <Form method="post" className="flex flex-col gap-6">
      <input type="hidden" name="userId" value={panel.subject.id} />
      {children}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save access"}
        </button>
        {mine && "error" in mine && mine.error ? <span className="text-sm text-red-700 dark:text-red-400">{mine.error}</span> : null}
        {mine && "saved" in mine ? (
          <span className="text-sm text-gray-500">
            {mine.saved === 0 ? "Nothing changed." : `Saved, ${mine.saved} ${mine.saved === 1 ? "change" : "changes"} logged.`}
          </span>
        ) : null}
      </div>
    </Form>
  );
}

/** One list in the form. The hidden `kind` tells the action it was shown. */
function GrantList({ kind, title, children }: { kind: GrantKind; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="index mb-2 w-full border-b border-gray-200 pb-1.5 text-gray-500">{title}</legend>
      <input type="hidden" name="kind" value={kind} />
      {children}
    </fieldset>
  );
}

function OwnerGrants({ panel }: { panel: Panel }) {
  const granted = new Set(panel.grants.owners);
  return (
    <GrantList kind="owner" title="Owners granted by hand">
      <div className="grid gap-1 text-sm sm:grid-cols-2">
        {panel.options.owners.map((owner) => (
          <label key={owner.id} className="flex min-h-10 items-center gap-2 md:min-h-0">
            <input type="checkbox" name="owner" value={owner.id} defaultChecked={granted.has(owner.id)} />
            {owner.name}
            {owner.kind !== "person" ? <span className="text-gray-500">({owner.kind})</span> : null}
          </label>
        ))}
      </div>
    </GrantList>
  );
}

function CategoryGrants({ panel }: { panel: Panel }) {
  const granted = new Set<string>(panel.grants.categories);
  return (
    <GrantList kind="category" title="Kinds of document">
      <div className="flex flex-wrap gap-4 text-sm">
        {CATEGORIES.map((category) => (
          <label key={category} className="flex min-h-10 items-center gap-2 capitalize md:min-h-0">
            <input type="checkbox" name="category" value={category} defaultChecked={granted.has(category)} />
            {category}
          </label>
        ))}
      </div>
    </GrantList>
  );
}

function recordLabel(record: RecordOption): string {
  return `${record.title} — ${record.ownerName} (${record.category}${record.isPrivate ? ", private" : ""})`;
}

function RecordGrants({ panel }: { panel: Panel }) {
  const granted = new Set(panel.grants.records.map((r) => r.id));
  return (
    <GrantList kind="record" title="Single records">
      {panel.grants.records.length === 0 ? (
        <p className="text-sm text-gray-500 max-w-prose">None. A private record is reachable only this way.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {panel.grants.records.map((record) => (
            <li key={record.id}>
              <label className="flex min-h-10 items-center gap-2 md:min-h-0">
                <input type="checkbox" name="record" value={record.id} defaultChecked />
                {recordLabel(record)}
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Add one
        <select name="record" defaultValue="" className="field min-w-0 font-normal">
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
    </GrantList>
  );
}

function MatrixView({ matrix }: { matrix: NonNullable<Route.ComponentProps["loaderData"]["matrix"]> }) {
  const cell = (n: number | undefined) => (n ? String(n) : "·");
  // Every cell opens its row's panel (D21). Out of the tab order, so the
  // keyboard gets one stop per account, on its name, rather than twenty.

  return (
    <section className="flex flex-col gap-2">
      <p className="text-sm text-gray-500 max-w-prose">
        Documents each account reaches, by whose they are and by kind, read as that account. Read-only:
        click a row to change it.
      </p>
      <div className="sheet scroll-cue overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-900 text-left align-bottom text-gray-500">
              <th className="index sticky left-0 z-10 bg-white px-3 pb-2 pt-4 md:pl-5">Account</th>
              <th className="index px-3 pb-2 pt-4">Reaches</th>
              {matrix.owners.map((owner) => (
                <th key={owner.id} className="index min-w-24 px-3 pb-2 pt-4 text-center">
                  {owner.name}
                </th>
              ))}
              {CATEGORIES.map((category) => (
                <th key={category} className="index px-3 pb-2 pt-4 text-center last:md:pr-5">
                  {category}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.user.id} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50">
                <th className="sticky left-0 z-10 border-r border-gray-200 bg-white px-3 py-3 text-left font-normal md:pl-5">
                  <Link className="whitespace-nowrap font-semibold underline decoration-gray-300" to={`/access?as=${row.user.id}`}>
                    {row.user.name}
                  </Link>
                  <span className="block text-xs text-gray-500">{roleLabel(row.user.role)}</span>
                </th>
                <td className="whitespace-nowrap px-3 py-3">
                  <span className="font-mono">{row.total}</span> of <span className="font-mono">{matrix.reachable}</span>
                </td>
                {matrix.owners.map((owner) => (
                  <td key={owner.id} className={"px-3 py-3 text-center font-mono " + (row.byOwner[owner.id] ? "" : "text-gray-500")}>
                    <Link tabIndex={-1} to={`/access?as=${row.user.id}`}>{cell(row.byOwner[owner.id])}</Link>
                  </td>
                ))}
                {CATEGORIES.map((category) => (
                  <td key={category} className={"px-3 py-3 text-center font-mono last:md:pr-5 " + (row.byCategory[category] ? "" : "text-gray-500")}>
                    <Link tabIndex={-1} to={`/access?as=${row.user.id}`}>{cell(row.byCategory[category])}</Link>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 max-w-prose">
        &ldquo;Of {matrix.reachable}&rdquo; is what you can see yourself, not a count of the database.
      </p>
    </section>
  );
}

function WindowNotice({ panel }: { panel: Panel }) {
  const result = useActionData<typeof action>();
  const window = panel.window!;
  return (
    <Form method="post" className="flex flex-col gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
      <p>
        Emergency window open until <When at={window.expiresAt} />.
        {window.reason ? <> They said: &ldquo;{window.reason}&rdquo;.</> : null}
      </p>
      <input type="hidden" name="intent" value="revoke-window" />
      <input type="hidden" name="userId" value={panel.subject.id} />
      <button type="submit" className="btn btn-danger self-start">Close it now</button>
      {result && result.kind === "window" && "error" in result ? <p>{result.error}</p> : null}
    </Form>
  );
}
