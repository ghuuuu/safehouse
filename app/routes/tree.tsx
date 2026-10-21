import { Link } from "react-router";

import type { Route } from "./+types/tree";
import type { OwnerLink } from "../tree";
import { Masthead, Page } from "../masthead";
import { Segmented } from "../segmented";
import { TreePicture } from "../tree-picture";
import { getFamilyTree } from "../tree.server";
import { resolveViewContext, withViewedVault } from "../view-as.server";

export function meta() {
  return [{ title: "Family tree — SafeHouse" }];
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
    <>
      <Masthead
        title="Family tree"
        serial={
          <>
            {tree.people.length} {tree.people.length === 1 ? "person" : "people"}
            {viewingAs ? ` · viewing as ${viewingAs.name}` : null}
          </>
        }
      />

      <Page>
        {viewingAs ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <p>
              You are seeing the tree as{" "}
              <strong className="font-semibold">{viewingAs.name}</strong>.
            </p>
            <Link className="underline" to={`/tree?tab=${tab}`}>
              Back to your own view
            </Link>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Segmented
            label="What to show"
            options={TABS.map((t) => ({ to: tabHref(t.value), label: t.label, current: tab === t.value }))}
          />
          <p className="text-sm text-gray-500 max-w-prose">
            Who documents belong to. Pick anyone to see their documents.
          </p>
        </div>

        {tab === "family" ? (
          <section className="sheet min-w-0 p-4 md:p-6">
            {tree.people.length === 0 ? (
              <p className="text-sm text-gray-500">
                Nobody in the family tree that you can see.{" "}
                {canAdd && !viewingAs ? (
                  <Link className="underline" to="/people">Add somebody</Link>
                ) : null}
              </p>
            ) : (
              <TreePicture people={tree.people} edges={tree.edges} vaultFor={vaultFor} />
            )}
          </section>
        ) : (
          <OwnerList
            owners={tab === "businesses" ? tree.businesses : tree.households}
            empty={tab === "businesses" ? "No businesses that you can see." : "No household that you can see."}
            vaultFor={vaultFor}
          />
        )}
      </Page>
    </>
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
    return <p className="sheet p-5 text-sm text-gray-500">{empty}</p>;
  }

  return (
    <ul className="sheet text-sm">
      {owners.map((owner) => (
        <li key={owner.ownerId} className="relative flex items-baseline justify-between gap-4 border-b border-gray-200 px-4 py-3 last:border-b-0 hover:bg-gray-50 md:px-5">
          <Link className="row-link font-semibold" to={vaultFor(owner.ownerId)}>
            {owner.name}
          </Link>
          <span className="font-mono text-xs text-gray-500">
            {owner.papers} {owner.papers === 1 ? "paper" : "papers"}
          </span>
        </li>
      ))}
    </ul>
  );
}
