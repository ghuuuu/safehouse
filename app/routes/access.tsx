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
  return [{ title: "Access — SafeHouse" }];
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
  const tab = new URL(request.url).searchParams.get("view");
  if (tab === "matrix") {
    return { roster, actorId: view.actor.id, how: false, matrix: await getMatrix(view.actor, roster), panel: null };
  }
  // The explainer is the same words for everybody; it reads nothing.
  if (tab === "how") {
    return { roster, actorId: view.actor.id, how: true, matrix: null, panel: null };
  }

  return {
    roster,
    actorId: view.actor.id,
    how: false,
    matrix: null,
    panel: view.isViewingAs ? await getPanel(view) : null,
  };
}

/** The account list, grouped the way the rules are: one heading per role. */
const ROLE_GROUPS = [
  { role: "admin", title: "Administrators" },
  { role: "individual", title: "Household members" },
  { role: "third_party", title: "Third parties" },
  { role: "emergency", title: "Emergency contacts" },
] as const;

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
  const { roster, actorId, how, matrix, panel } = loaderData;
  const tab = matrix ? "matrix" : how ? "how" : "one";

  return (
    <>
      <Masthead
        // The grid of everyone is the one wide view: it has a column per owner.
        wide={tab === "matrix"}
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

      <Page wide={tab === "matrix"}>
        <Segmented
          label="Access"
          options={[
            { to: "/access", label: "One account", current: tab === "one" },
            { to: "/access?view=matrix", label: "Everyone at once", current: tab === "matrix" },
            { to: "/access?view=how", label: "How access works", current: tab === "how" },
          ]}
        />

      {matrix ? (
        <MatrixView matrix={matrix} />
      ) : how ? (
        <HowItWorks />
      ) : (
        // minmax(0, 1fr): a long record name in "Add one" must not widen the
        // column past the screen.
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Accounts" className="sheet">
            {ROLE_GROUPS.map(({ role, title }) => {
              const members = roster.filter((entry) => entry.role === role);
              if (members.length === 0) return null;
              return (
                <div key={role} className="border-b border-gray-200 last:border-b-0">
                  <p className="index flex justify-between px-4 pb-1.5 pt-3.5 text-gray-500">
                    {title} <span className="font-mono">{members.length}</span>
                  </p>
                  <ul className="flex flex-col pb-1.5 text-sm">
                    {members.map((entry) => (
                      <li
                        key={entry.id}
                        className={
                          "relative mx-1.5 rounded-md px-2.5 py-2 " +
                          (entry.id === panel?.subject.id ? "bg-gray-100" : "hover:bg-gray-50")
                        }
                      >
                        {entry.id === actorId ? (
                          <span className="text-gray-500">{entry.name} (you)</span>
                        ) : (
                          <Link
                            className={"row-link no-underline " + (entry.id === panel?.subject.id ? "font-semibold" : "font-medium")}
                            to={`/access?as=${entry.id}`}
                            aria-current={entry.id === panel?.subject.id ? "page" : undefined}
                          >
                            {entry.name}
                          </Link>
                        )}
                        {entry.disabled ? <span className="block text-xs text-gray-500">disabled</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>

          {panel ? (
            // On a phone, the chosen account comes first and the list after it.
            <div className="order-first md:order-none">
              <PanelView key={panel.subject.id} panel={panel} />
            </div>
          ) : (
            <div className="sheet flex max-w-prose flex-col gap-2 p-5 text-sm text-gray-500">
              <p>
                Pick an account to see what it reaches and change what it is granted. Editing happens
                here, one person at a time; the grid of everyone is for checking, and is read-only.
              </p>
              <p>
                New to this? <Link to="/access?view=how" className="underline">How access works</Link> says
                what each kind of account sees, in a page.
              </p>
            </div>
          )}
        </div>
      )}
      </Page>
    </>
  );
}

/**
 * What the rules are, in words. Written from the permission views
 * (`drizzle/0001_permission_layer.sql`, `0003_identity_boundary.sql`), which
 * are the rules; if they change, this changes with them. Nothing here is
 * read from the database.
 */
function HowItWorks() {
  const card = "sheet flex flex-col gap-2 p-5";
  const head = "text-xl font-semibold tracking-[-0.015em]";
  const body = "text-sm text-gray-700 max-w-prose";
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-base text-gray-700">
        Every rule below lives in the database, not in these pages. A page can only show what the
        signed-in account is allowed to read, so the quickest way to check anybody is to open them under
        One account and press <em>See the vault as</em>.
      </p>

      <section aria-labelledby="roles" className="flex flex-col gap-3">
        <h2 id="roles" className="text-2xl font-semibold tracking-[-0.02em]">Four kinds of account</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className={card}>
            <h3 className={head}>Administrator</h3>
            <p className={body}>
              Sees every paper, private ones included: private means private from the family, not from
              whoever runs the vault. The only account that grants access, adds people, sends invites and
              changes the household&apos;s settings.
            </p>
          </article>
          <article className={card}>
            <h3 className={head}>Household member</h3>
            <p className={body}>
              Sees their own papers and their close family&apos;s, worked out from the tree: their spouse
              (until a divorce), their parents, their children, and their spouse&apos;s parents. Brothers,
              sisters and grandparents are outside it. A step-parent never comes in through the tree; a
              guardian does while the guardianship lasts. They also see the household&apos;s own papers, the
              deed or the marriage certificate, once their sign-in is attached to somebody on the tree.
              Somebody else&apos;s private papers stay hidden from them.
            </p>
          </article>
          <article className={card}>
            <h3 className={head}>Third party</h3>
            <p className={body}>
              An accountant or a lawyer. Sees nothing until you grant it, and then only where two lists
              agree: <strong className="font-semibold">whose</strong> papers, and{" "}
              <strong className="font-semibold">what kind</strong>. A business ticked with Financial shows that
              business&apos;s financial papers and nothing else; an owner with no kind ticked shows nothing.
              Never private papers, unless one is granted on its own.
            </p>
          </article>
          <article className={card}>
            <h3 className={head}>Emergency contact</h3>
            <p className={body}>
              Sees nothing at all until they open an emergency window themselves. Then, for the hours set
              under Settings, they see every medical and legal paper in the household, private ones
              included, because a hidden advance directive would defeat the point. You are alerted when a
              window opens, and can close it early from their panel here.
            </p>
          </article>
        </div>
      </section>

      <section aria-labelledby="by-hand" className="flex flex-col gap-3">
        <h2 id="by-hand" className="text-2xl font-semibold tracking-[-0.02em]">What you can add by hand</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className={card}>
            <h3 className={head}>An owner</h3>
            <p className={body}>
              For a household member, an owner granted by hand adds that person&apos;s or business&apos;s
              papers on top of their family: the step-parent who should see a step-child&apos;s papers, or
              the relative who runs the family business. Their private papers still stay hidden.
            </p>
          </article>
          <article className={card}>
            <h3 className={head}>A single paper</h3>
            <p className={body}>
              One record, to one account, whatever its owner or kind. It is the only way for anybody but
              its owner and the administrator to see a private paper, such as a will shown to the lawyer
              who drew it up.
            </p>
          </article>
        </div>
      </section>

      <section aria-labelledby="always" className="sheet flex flex-col gap-2 p-5">
        <h2 id="always" className="text-xl font-semibold tracking-[-0.015em]">Always true</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-gray-700 marker:text-gray-400">
          <li>Rules only add up: any one of them letting somebody see a paper is enough. Marking a paper private is the one thing that narrows them.</li>
          <li>A divorce, or a guardianship that ends, takes them out of the family circle as soon as it is recorded on the tree.</li>
          <li>A disabled account sees nothing, whatever it was granted.</li>
          <li>Opening a file asks for the password again unless it was typed in the last few minutes, even when signed in.</li>
          <li>Every change to access is written to the activity log.</li>
        </ul>
      </section>
    </div>
  );
}

function PanelView({ panel }: { panel: Panel }) {
  const { subject, reach, reachable, reaches, grantable } = panel;

  return (
    <section className="sheet flex flex-col gap-6 p-4 md:p-6">
      <div className="border-b border-gray-200 pb-2">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">{subject.name}</h2>
        <p className="text-sm text-gray-500 max-w-prose">
          {roleLabel(subject.role)}
          {subject.disabled ? ", disabled: reaches nothing until re-enabled" : ""}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {/* The sentence below says the numbers; this bar only shows them. */}
        <div aria-hidden className="h-2 overflow-hidden rounded-xs bg-gray-200">
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
  // Reached without a grant: through the tree, or the household's own papers.
  // Ticking one of those adds nothing, so the list says so.
  const already = new Set(panel.reaches.filter((owner) => !owner.granted).map((owner) => owner.id));
  return (
    <GrantList kind="owner" title="Owners granted by hand">
      <div className="grid gap-1 text-sm sm:grid-cols-2">
        {panel.options.owners.map((owner) => (
          <label key={owner.id} className="flex min-h-10 items-center gap-2 md:min-h-0">
            <input type="checkbox" name="owner" value={owner.id} defaultChecked={granted.has(owner.id)} />
            {/* One run of text, so a long name wraps as a sentence rather than in columns. */}
            <span className={already.has(owner.id) ? "text-gray-500" : undefined}>
              {owner.name}
              {owner.kind !== "person" ? <span className="text-gray-500"> ({owner.kind})</span> : null}
              {already.has(owner.id) ? <span className="whitespace-nowrap text-xs text-gray-500"> · already sees</span> : null}
            </span>
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
            <tr className="border-b border-gray-200 text-left align-bottom text-gray-500">
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
