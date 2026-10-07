import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import type { Route } from "./+types/tree";
import type { OwnerLink, TreeEdge, TreePerson } from "../tree";
import { layoutTree, NODE_HEIGHT, NODE_WIDTH, type Layout } from "../tree-layout";
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
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
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
          <Link className="underline" to="/">Home</Link>
          <Link className="underline" to={`/vault${as ? `?${as}` : ""}`}>Vault</Link>
          <Link className="underline" to="/people">People</Link>
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

const PAD = 40;
const SEX_MARK = { female: "♀", male: "♂" } as const;

/**
 * The tree as an SVG. Drag to pan, wheel or buttons to zoom. Every person is a
 * link, so Tab reaches them and Enter opens them without a mouse.
 */
function TreePicture({
  people,
  edges,
  vaultFor,
}: {
  people: TreePerson[];
  edges: TreeEdge[];
  vaultFor: (ownerId: string) => string;
}) {
  const layout = layoutTree(people, edges);
  // Each parent's lines to their children run at their own height, so that
  // three parents of one child do not merge into one line nobody can trace.
  const lanes = new Map<string, number>();
  for (const edge of edges) {
    if (edge.kind !== "parent_of" || lanes.has(edge.from)) continue;
    const row = layout.positions[edge.from]?.y;
    const taken = [...lanes].filter(([id]) => layout.positions[id]?.y === row).length;
    lanes.set(edge.from, taken % 4);
  }
  const home = {
    x: -PAD,
    y: -PAD,
    w: Math.max(layout.width + PAD * 2, 600),
    h: layout.height + PAD * 2,
  };
  const [box, setBox] = useState(home);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const navigate = useNavigate();

  const zoom = (factor: number) =>
    setBox((b) => {
      const w = b.w * factor;
      const h = b.h * factor;
      return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
    });

  // Registered by hand because React's wheel listener is passive, and a
  // passive listener cannot stop the page scrolling under the zoom.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY > 0 ? 1.1 : 1 / 1.1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const toSvgUnits = (pixels: number) =>
    pixels * (box.w / (svg.current?.clientWidth || box.w));

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <button type="button" className="rounded border border-gray-300 px-2" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in">+</button>
        <button type="button" className="rounded border border-gray-300 px-2" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
        <button type="button" className="rounded border border-gray-300 px-2" onClick={() => setBox(home)}>Reset</button>
        <span className="text-xs text-gray-500">Drag to move around.</span>
      </div>

      <svg
        ref={svg}
        role="group"
        aria-label="Family tree"
        className="h-[32rem] w-full cursor-grab touch-none select-none rounded-lg border border-gray-200 bg-white active:cursor-grabbing dark:bg-gray-950"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (!start.moved && Math.hypot(dx, dy) < 4) return;
          if (!start.moved) svg.current?.setPointerCapture(event.pointerId);
          start.moved = true;
          start.x = event.clientX;
          start.y = event.clientY;
          setBox((b) => ({ ...b, x: b.x - toSvgUnits(dx), y: b.y - toSvgUnits(dy) }));
        }}
        onPointerUp={() => {
          // A drag that ends on a person is not a click on them.
          setTimeout(() => (drag.current = null), 0);
        }}
      >
        {edges.map((edge) => (
          <Edge
            key={`${edge.kind}:${edge.from}:${edge.to}`}
            edge={edge}
            layout={layout}
            lane={lanes.get(edge.from) ?? 0}
          />
        ))}

        {people.map((person) => {
          const at = layout.positions[person.ownerId];
          const description = [
            person.name,
            person.sex,
            person.deceased ? "deceased" : null,
          ].filter(Boolean).join(", ");

          return (
            <a
              key={person.ownerId}
              href={vaultFor(person.ownerId)}
              aria-label={`${description}. Open their documents.`}
              className="group outline-none"
              onClick={(event) => {
                event.preventDefault();
                if (drag.current?.moved) return;
                navigate(vaultFor(person.ownerId));
              }}
            >
              <rect
                x={at.x}
                y={at.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                className={
                  "stroke-gray-300 group-hover:stroke-gray-900 group-focus-visible:stroke-blue-600 group-focus-visible:[stroke-width:3] " +
                  (person.deceased ? "fill-gray-100 dark:fill-gray-800" : "fill-white dark:fill-gray-900")
                }
              />
              <text
                x={at.x + 12}
                y={at.y + NODE_HEIGHT / 2}
                dominantBaseline="central"
                className={"text-[13px] " + (person.deceased ? "fill-gray-500" : "fill-gray-900 dark:fill-gray-100")}
              >
                {truncate(person.name)}
                {person.deceased ? " †" : ""}
              </text>
              {person.sex ? (
                <text
                  x={at.x + NODE_WIDTH - 12}
                  y={at.y + NODE_HEIGHT / 2}
                  dominantBaseline="central"
                  textAnchor="end"
                  aria-hidden="true"
                  className="fill-gray-500 text-[14px]"
                >
                  {SEX_MARK[person.sex]}
                </text>
              ) : null}
            </a>
          );
        })}
      </svg>

      <p className="text-xs text-gray-500">
        † deceased · ♀ female · ♂ male · dashed grey lines are relationships that
        have ended (a divorce, a guardianship that ran out). They are shown as
        history and give nobody access.
      </p>
    </section>
  );
}

function Edge({ edge, layout, lane }: { edge: TreeEdge; layout: Layout; lane: number }) {
  const from = layout.positions[edge.from];
  const to = layout.positions[edge.to];
  if (!from || !to) return null;

  const style = edge.ended
    ? "stroke-gray-300 [stroke-dasharray:6_4] dark:stroke-gray-700"
    : "stroke-gray-500";

  if (edge.kind === "spouse_of") {
    const [left, right] = from.x < to.x ? [from, to] : [to, from];
    const y = left.y + NODE_HEIGHT / 2;
    const x1 = left.x + NODE_WIDTH;
    const x2 = right.x;
    return (
      <g>
        <line x1={x1} y1={y} x2={x2} y2={y} className={style} strokeWidth={2} />
        {/* Only a divorce ends a marriage here; a death does not (0001). */}
        {edge.ended ? <Label x={(x1 + x2) / 2} y={y - 8} text="divorced" /> : null}
      </g>
    );
  }

  // Parent to child: down, across, down.
  const x1 = from.x + NODE_WIDTH / 2;
  const y1 = from.y + NODE_HEIGHT;
  const x2 = to.x + NODE_WIDTH / 2;
  const y2 = to.y;
  const mid = (y1 + y2) / 2 + (lane - 1.5) * 10;
  const kind = edge.parentType && edge.parentType !== "biological" ? edge.parentType : null;
  const label = edge.ended ? `former ${kind ?? "parent"}` : kind;

  return (
    <g>
      <path
        d={`M ${x1} ${y1} V ${mid} H ${x2} V ${y2}`}
        fill="none"
        className={style}
        strokeWidth={1.5}
      />
      {label ? <Label x={x2} y={y2 - 6} text={label} /> : null}
    </g>
  );
}

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" className="fill-gray-500 text-[10px]">
      {text}
    </text>
  );
}

function truncate(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}
