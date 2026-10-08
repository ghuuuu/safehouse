/**
 * The family tree, drawn: shared by `/tree` and the dashboard.
 *
 * Presentation only. It is handed people and edges a loader already read
 * through the policies, and draws exactly those.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { TreeEdge, TreePerson } from "./tree";
import { layoutTree, NODE_HEIGHT, NODE_WIDTH, type Layout } from "./tree-layout";

const PAD = 40;
/**
 * The smallest scale the tree opens at: names stay about 11px and a person is
 * about 40px tall, which a thumb can hit. A wider tree than that opens on its
 * left edge and is panned, rather than shrunk until nobody can read it.
 */
const MIN_SCALE = 0.85;
const SEX_MARK = { female: "♀", male: "♂" } as const;

/**
 * The tree as an SVG. Drag to pan, wheel or buttons to zoom. Every person is a
 * link, so Tab reaches them and Enter opens them without a mouse.
 */
export function TreePicture({
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
  const whole = {
    x: -PAD,
    y: -PAD,
    w: Math.max(layout.width + PAD * 2, 600),
    h: layout.height + PAD * 2,
  };
  const svg = useRef<SVGSVGElement>(null);
  // The server cannot know the screen, so it draws the whole tree; the first
  // render in the browser narrows it when the whole tree would be unreadable.
  const fit = () => {
    const element = svg.current;
    if (!element || element.clientWidth === 0) return whole;
    const scale = Math.min(element.clientWidth / whole.w, element.clientHeight / whole.h);
    if (scale >= MIN_SCALE) return whole;
    return { x: whole.x, y: whole.y, w: element.clientWidth / MIN_SCALE, h: element.clientHeight / MIN_SCALE };
  };
  const [box, setBox] = useState(whole);
  // Once, on mount: after that the reader is in charge of where it looks.
  useEffect(() => setBox(fit()), []);
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
        <button type="button" className="min-h-9 min-w-9 rounded border border-gray-300 px-2" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in">+</button>
        <button type="button" className="min-h-9 min-w-9 rounded border border-gray-300 px-2" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>
        <button type="button" className="min-h-9 rounded border border-gray-300 px-3" onClick={() => setBox(fit())}>Reset</button>
        <span className="text-xs text-gray-500">
          <span className="pointer-coarse:hidden">Drag to move around.</span>
          <span className="hidden pointer-coarse:inline">Swipe sideways to move along.</span>
        </span>
      </div>

      <svg
        ref={svg}
        role="group"
        aria-label="Family tree"
        className="h-[24rem] w-full cursor-grab touch-pan-y select-none md:h-[32rem] pointer-fine:touch-none rounded-lg border border-gray-200 bg-white active:cursor-grabbing"
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
        // The browser took the gesture over to scroll the page (touch-pan-y).
        onPointerCancel={() => (drag.current = null)}
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
                  (person.deceased ? "fill-gray-100" : "fill-white")
                }
              />
              <text
                x={at.x + 12}
                y={at.y + NODE_HEIGHT / 2}
                dominantBaseline="central"
                className={"text-[13px] " + (person.deceased ? "fill-gray-500" : "fill-gray-900")}
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

      <p className="text-xs text-gray-500 max-w-prose">
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
    ? "stroke-gray-300 [stroke-dasharray:6_4]"
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
