import { Link } from "react-router";

import type { Route } from "./+types/tree";
import type { OwnerLink } from "../tree";
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

      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Family tree</h1>
          <p className="mt-1 text-sm text-gray-500">
            Who documents belong to. Pick anyone to see their documents.
          </p>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link className="py-2 underline" to={`/vault${as ? `?${as}` : ""}`}>Vault</Link>
          <Link className="py-2 underline" to="/people">People</Link>
        </nav>
      </div>

      <nav aria-label="What to show" className="flex gap-1 border-b border-gray-200 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.value}
            to={tabHref(t.value)}
            aria-current={tab === t.value ? "page" : undefined}
            className={
              tab === t.value
                ? "-mb-px border-b-2 border-gray-900 px-3 py-2 font-medium"
                : "px-3 py-2 text-gray-500"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

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
    <ul className="rounded-lg border border-gray-200 text-sm">
      {owners.map((owner) => (
        <li key={owner.ownerId} className="border-b border-gray-100 p-4 last:border-b-0">
          <Link className="underline" to={vaultFor(owner.ownerId)}>
            {owner.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
