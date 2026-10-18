/**
 * The family tree, drawn: shared by `/tree` and the dashboard.
 *
 * Presentation only. It is handed people and edges a loader already read
 * through the policies, and draws exactly those.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { TreeEdge, TreePerson } from "./tree";
import { familyLines, layoutTree, NODE_HEIGHT, NODE_WIDTH } from "./tree-layout";

const PAD = 40;
/**
 * The smallest scale the tree opens at: 14px names stay about 11px and a
 * person is about 32px tall, which a thumb can still hit. A wider tree than
 * that opens on its left edge and is panned, rather than shrunk until nobody
 * can read it.
 */
const MIN_SCALE = 0.8;

/** Something about a person's papers that needs them, hung on their name. */
export type MapTag = { text: string; tone: "warn" | "soon" };

/**
 * The tree as an SVG, engraved like a certificate's family chart: people are
 * names in ruled boxes, joined by one ink. Drag to pan, wheel or buttons to
 * zoom. Every person is a
 * link, so Tab reaches them and Enter opens them without a mouse; the tag on
 * a name is in its label too, so it is not colour alone.
 */
export function TreePicture({
  people,
  edges,
  vaultFor,
  tags,
}: {
  people: TreePerson[];
  edges: TreeEdge[];
  vaultFor: (ownerId: string) => string;
  /** Read by the loader through the viewer's own transaction, like the tree. */
  tags?: Map<string, MapTag[]>;
}) {
  const layout = layoutTree(people, edges);
  const lines = familyLines(edges, layout);
  const whole = {
    x: -PAD,
    y: -PAD - (tags?.size ? 24 : 0),
    w: Math.max(layout.width + PAD * 2, 600),
    h: layout.height + PAD * 2 + (tags?.size ? 24 : 0),
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
        <button type="button" className="btn btn-secondary btn-sm min-w-9 px-0" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in"><ZoomGlyph plus /></button>
        <button type="button" className="btn btn-secondary btn-sm min-w-9 px-0" onClick={() => zoom(1.25)} aria-label="Zoom out"><ZoomGlyph /></button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBox(fit())}>Reset</button>
        <span className="text-xs text-gray-500">
          <span className="pointer-coarse:hidden">Drag to move around.</span>
          <span className="hidden pointer-coarse:inline">Swipe sideways to move along.</span>
        </span>
      </div>

      <svg
        ref={svg}
        role="group"
        aria-label="Family tree"
        className="h-[24rem] w-full cursor-grab touch-pan-y select-none md:h-[32rem] pointer-fine:touch-none active:cursor-grabbing"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        // No taller than the family itself, so a small household is not an
        // island in a sea of empty map.
        style={{ maxHeight: whole.h }}
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
        {lines.map((line) => (
          <path
            key={line.key}
            d={line.d}
            fill="none"
            stroke={line.colour === "guardian" ? "var(--line-guardian)" : "var(--line)"}
            strokeWidth={line.colour === "guardian" ? 2 : 1.5}
            strokeLinejoin="miter"
            strokeDasharray={line.ended ? "5 5" : line.colour === "guardian" ? "10 3 2 3" : undefined}
            opacity={line.ended ? 0.7 : 1}
          />
        ))}
        {lines.map((line) => {
          if (!line.label || !line.child) return null;
          const to = layout.positions[line.child];
          return <Label key={`label:${line.key}`} x={to.x + NODE_WIDTH / 2 + 8} y={to.y - 10} text={line.label} />;
        })}

        {people.map((person) => {
          const at = layout.positions[person.ownerId];
          const own = tags?.get(person.ownerId) ?? [];
          const description = [
            person.name,
            person.deceased ? "deceased" : null,
            `${person.papers} ${person.papers === 1 ? "paper" : "papers"}`,
            ...own.map((tag) => tag.text),
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
              {/* A name in a ruled box, framed twice like an entry on a certificate. */}
              <rect
                x={at.x}
                y={at.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={2}
                strokeWidth={1.25}
                strokeDasharray={person.deceased ? "4 3" : undefined}
                className={
                  "fill-white group-hover:stroke-accent group-focus-visible:stroke-accent group-focus-visible:[stroke-width:3] " +
                  (person.deceased ? "stroke-gray-400" : "stroke-gray-900")
                }
              />
              {person.deceased ? null : (
                <rect
                  x={at.x + 3}
                  y={at.y + 3}
                  width={NODE_WIDTH - 6}
                  height={NODE_HEIGHT - 6}
                  rx={1}
                  fill="none"
                  strokeWidth={0.5}
                  className="stroke-gray-400"
                />
              )}
              <text
                x={at.x + 14}
                y={at.y + NODE_HEIGHT / 2}
                dominantBaseline="central"
                textAnchor="start"
                className={"text-[14px] font-semibold " + (person.deceased ? "fill-gray-500" : "fill-gray-900")}
              >
                {truncate(person.name)}
                {person.deceased ? " †" : ""}
              </text>
              <text
                x={at.x + NODE_WIDTH - 12}
                y={at.y + NODE_HEIGHT / 2}
                dominantBaseline="central"
                textAnchor="end"
                className="fill-gray-500 font-mono text-[12px]"
              >
                {person.papers}
              </text>
              {own.length > 0 ? <Tag x={at.x + NODE_WIDTH / 2} y={at.y - 8} tag={own[0]} more={own.length - 1} /> : null}
            </a>
          );
        })}
      </svg>

      <p className="text-xs text-gray-500 max-w-prose">
        A couple shares a line, and their children hang from it. The gold
        dash-and-dot line is guardianship. Dashed lines have ended (a divorce, a
        guardianship that ran out) and give nobody access. † has died. The number
        in a name&apos;s box is how many papers you can see for them.
      </p>
    </section>
  );
}

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} textAnchor="start" className="fill-gray-500 text-[11px]">
      {text}
    </text>
  );
}

function Tag({ x, y, tag, more }: { x: number; y: number; tag: MapTag; more: number }) {
  const text = more > 0 ? `${tag.text} +${more}` : tag.text;
  // Stamped, not pinned: a ruled frame in the tone's ink, the words in capitals.
  const width = text.length * 7.6 + 18;
  const ink = tag.tone === "warn" ? "var(--warn)" : "var(--soon-ink)";
  return (
    <g aria-hidden="true" transform={`rotate(-2 ${x} ${y - 12})`}>
      <rect x={x - width / 2} y={y - 24} width={width} height={22} rx={1.5} fill="var(--sheet)" stroke={ink} strokeWidth={1.5} />
      <rect x={x - width / 2 + 2.5} y={y - 21.5} width={width - 5} height={17} rx={1} fill="none" stroke={ink} strokeWidth={0.5} />
      <text x={x} y={y - 13} dominantBaseline="central" textAnchor="middle" fill={ink} className="text-[11px] font-bold uppercase tracking-[0.1em]">
        {text}
      </text>
    </g>
  );
}

function truncate(name: string): string {
  return name.length > 15 ? `${name.slice(0, 14)}…` : name;
}

/** The zoom buttons' marks, drawn rather than typed. */
function ZoomGlyph({ plus }: { plus?: boolean }) {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M1.5 6h9" />
      {plus ? <path d="M6 1.5v9" /> : null}
    </svg>
  );
}