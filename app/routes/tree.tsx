import { Link } from "react-router";

import type { Route } from "./+types/tree";
import type { OwnerLink } from "../tree";
import { Segmented } from "../segmented";
import { TreePicture } from "../tree-picture";
import { getFamilyTree } from "../tree.server";
import { resolveViewContext, withViewedVault } from "../view-as.server";

export function meta() {
  return [{ title: "Family tree — Safehouse" }];
}

const TABS = [
  { value: "family", label: "Family" },
  { value: "businesses", label: "Businesses" },
  { value: "household", label: "Household" },
] as const;

type Tab = (typeof TABS)[number]["value"];

/**
 * How this surface enforces access.
 *
 * `getFamilyTree` has no permission logic. It reads `owners`, `people` and
 * `relationships` inside `withViewedVault`, so the policies decide who is drawn.
 * Under view-as that is the viewed user's answer, and `relationships_read`
 * returns a line only when both of its ends are visible. Clicking somebody goes
 * to `/vault?owner=`, which narrows rows the vault's own policies returned and
 * cannot add any (`app/vault.server.ts`).
 *
 * The payload is a name, a deceased flag and sex per person. No given name,
 * family name or date of birth, because nothing here draws them.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const view = await resolveViewContext(request);
  const tree = await withViewedVault(view, (db) => getFamilyTree(db));

  const asked = new URL(request.url).searchParams.get("tab");
  const tab: Tab = TABS.some((t) => t.value === asked) ? (asked as Tab) : "family";

  return {
    tree,
    tab,
    canAdd: view.actor.role === "admin",
    viewingAs: view.isViewingAs && view.viewedUser
      ? { id: view.viewedUser.id, name: view.viewedUser.name }
      : null,
  };
}

export default function FamilyTree({ loaderData }: Route.ComponentProps) {
  const { tree, tab, canAdd, viewingAs } = loaderData;
  // Every link keeps whose eyes are being used.
  const as = viewingAs ? `as=${viewingAs.id}` : "";
  const vaultFor = (ownerId: string) => `/vault?owner=${ownerId}${as ? `&${as}` : ""}`;
  const tabHref = (value: Tab) => `/tree?tab=${value}${as ? `&${as}` : ""}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 md:p-8">
      {viewingAs ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p>
            You are seeing the tree as{" "}
            <strong className="font-medium">{viewingAs.name}</strong>.
          </p>
          <Link className="underline" to={`/tree?tab=${tab}`}>
            Back to your own view
          </Link>
        </div>
      ) : null}

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Family tree</h1>
        <p className="mt-1 text-sm text-gray-500 max-w-prose">
          Who documents belong to. Pick anyone to see their documents.
        </p>
      </div>

      <Segmented
        label="What to show"
        options={TABS.map((t) => ({ to: tabHref(t.value), label: t.label, current: tab === t.value }))}
      />

      {tab === "family" ? (
        tree.people.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            Nobody in the family tree that you can see.{" "}
            {canAdd && !viewingAs ? (
              <Link className="underline" to="/people">Add somebody</Link>
            ) : null}
          </p>
        ) : (
          <TreePicture people={tree.people} edges={tree.edges} vaultFor={vaultFor} />
        )
      ) : (
        <OwnerList
          owners={tab === "businesses" ? tree.businesses : tree.households}
          empty={tab === "businesses" ? "No businesses that you can see." : "No household that you can see."}
          vaultFor={vaultFor}
        />
      )}
    </main>
  );
}

function OwnerList({
  owners,
  empty,
  vaultFor,
}: {
  owners: OwnerLink[];
  empty: string;
  vaultFor: (ownerId: string) => string;
}) {
  if (owners.length === 0) {
    return <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600">{empty}</p>;
  }

  return (
    <ul className="rounded-lg border border-gray-200 bg-white text-sm">
      {owners.map((owner) => (
        <li key={owner.ownerId} className="relative flex items-baseline justify-between gap-4 border-b border-gray-100 p-4 last:border-b-0">
          <Link className="row-link underline" to={vaultFor(owner.ownerId)}>
            {owner.name}
          </Link>
          <span className="text-gray-500">
            {owner.papers} {owner.papers === 1 ? "paper" : "papers"}
          </span>
        </li>
      ))}
    </ul>
  );
}
