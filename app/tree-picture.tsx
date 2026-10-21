/**
 * The family tree, drawn: shared by `/tree` and the dashboard.
 *
 * Presentation only. It is handed people and edges a loader already read
 * through the policies, and draws exactly those.
 */

import { useEffect, useRef } from "react";
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
/** How quickly the view catches up with a zoom or a throw: about 90% there in 200ms. */
const GLIDE_MS = 90;
/** How far a throw carries, as the milliseconds of travel at the speed it was let go. */
const THROW_MS = 220;

type Box = { x: number; y: number; w: number; h: number };

/** Something about a person's papers that needs them, hung on their name. */
export type MapTag = { text: string; tone: "warn" | "soon" };

/**
 * The tree as an SVG: people are names on raised cards, joined by one quiet
 * line. Drag to pan, pinch, Ctrl-wheel or buttons to zoom. Every person is a
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
    // Narrowed about the middle of the family, so the first view is people,
    // not the empty corner above the eldest.
    // No taller than the family at this scale, so there is no empty band.
    const height = Math.min(element.clientHeight, whole.h * MIN_SCALE);
    element.style.height = `${height}px`;
    const w = element.clientWidth / MIN_SCALE;
    const h = height / MIN_SCALE;
    return { x: whole.x + (whole.w - w) / 2, y: whole.y + (whole.h - h) / 2, w, h };
  };
  // Where the view is drawn, and where it is heading. The view glides towards
  // the goal a frame at a time and is written straight onto the SVG, so a
  // wheel, a pinch or a button never jumps and React never re-renders the tree
  // sixty times a second.
  const view = useRef<Box>(whole);
  const goal = useRef<Box>(whole);
  const frame = useRef(0);
  const drag = useRef<{ x: number; y: number; t: number; vx: number; vy: number; moved: boolean } | null>(null);
  const navigate = useNavigate();

  const draw = () => {
    const b = view.current;
    svg.current?.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
  };

  /** Never zoomed past a few names or out past twice the family, never panned off it. */
  const clamp = (b: Box): Box => {
    const w = Math.min(Math.max(b.w, 240), whole.w * 2.5);
    const h = b.h * (w / b.w);
    const x = Math.min(Math.max(b.x, whole.x - w / 2), whole.x + whole.w - w / 2);
    const y = Math.min(Math.max(b.y, whole.y - h / 2), whole.y + whole.h - h / 2);
    return { x, y, w, h };
  };

  const glide = (next: Box, instant = false) => {
    goal.current = clamp(next);
    if (instant || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      view.current = goal.current;
      draw();
      return;
    }
    if (frame.current) return;
    let last = performance.now();
    const step = (now: number) => {
      // Eased by time, not by frame, so a slow screen glides as far.
      const t = 1 - Math.exp(-(now - last) / GLIDE_MS);
      last = now;
      const v = view.current;
      const g = goal.current;
      if (Math.abs(g.x - v.x) + Math.abs(g.y - v.y) + Math.abs(g.w - v.w) < g.w / 2000) {
        view.current = g;
        frame.current = 0;
      } else {
        view.current = { x: v.x + (g.x - v.x) * t, y: v.y + (g.y - v.y) * t, w: v.w + (g.w - v.w) * t, h: v.h + (g.h - v.h) * t };
        frame.current = requestAnimationFrame(step);
      }
      draw();
    };
    frame.current = requestAnimationFrame(step);
  };

  /** SVG units per screen pixel, as drawn. */
  const unitsPerPixel = () => {
    const ctm = svg.current?.getScreenCTM();
    return ctm ? 1 / ctm.a : 1;
  };

  /** Zoom by `factor` about a point on screen, the middle if none: that point stays put. */
  const zoom = (factor: number, clientX?: number, clientY?: number) => {
    const element = svg.current;
    const g = goal.current;
    let px = g.x + g.w / 2;
    let py = g.y + g.h / 2;
    const ctm = element?.getScreenCTM();
    if (element && ctm && clientX !== undefined && clientY !== undefined) {
      const at = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      px = at.x;
      py = at.y;
    }
    glide({ x: px - (px - g.x) * factor, y: py - (py - g.y) * factor, w: g.w * factor, h: g.h * factor });
  };

  // Once, on mount: after that the reader is in charge of where it looks.
  useEffect(() => {
    glide(fit(), true);
    return () => cancelAnimationFrame(frame.current);
  }, []);

  // Registered by hand because React's wheel listener is passive, and a
  // passive listener cannot stop the page scrolling under the zoom. A plain
  // wheel scrolls the page past the tree; a pinch, or the wheel with Ctrl or
  // Cmd held, zooms it, following how far it moved rather than a fixed step.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      // A trackpad pinch arrives as a ctrl-wheel.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
      // A pinch is many small steps; a mouse notch is one big one, so it
      // moves about a fifth and the glide carries it the rest of the way.
      const notch = event.deltaMode !== 0 || Math.abs(pixels) >= 50;
      zoom(Math.exp(pixels * (notch ? 0.002 : 0.01)), event.clientX, event.clientY);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <button type="button" className="btn btn-secondary btn-sm min-w-9 px-0" onClick={() => zoom(1 / 1.25)} aria-label="Zoom in"><ZoomGlyph plus /></button>
        <button type="button" className="btn btn-secondary btn-sm min-w-9 px-0" onClick={() => zoom(1.25)} aria-label="Zoom out"><ZoomGlyph /></button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => glide(fit())}>Reset</button>
        <span className="text-xs text-gray-500">
          <span className="pointer-coarse:hidden">Drag to move around. Pinch, or Ctrl and scroll, to zoom.</span>
          <span className="hidden pointer-coarse:inline">Swipe sideways to move along.</span>
        </span>
      </div>

      <svg
        ref={svg}
        role="group"
        aria-label="Family tree"
        className="h-[24rem] w-full cursor-grab touch-pan-y select-none rounded-lg bg-paper md:h-[32rem] pointer-fine:touch-none active:cursor-grabbing"
        // Drawn from here on by `draw`; React only sets where it starts.
        viewBox={`${whole.x} ${whole.y} ${whole.w} ${whole.h}`}
        // No taller than the family itself, so a small household is not an
        // island in a sea of empty map.
        style={{ maxHeight: whole.h }}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, t: event.timeStamp, vx: 0, vy: 0, moved: false };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (!start.moved && Math.hypot(dx, dy) < 4) return;
          if (!start.moved) svg.current?.setPointerCapture(event.pointerId);
          start.moved = true;
          // Pixels a millisecond, smoothed, for the throw when the drag ends.
          const dt = Math.max(1, event.timeStamp - start.t);
          start.vx = start.vx * 0.6 + (dx / dt) * 0.4;
          start.vy = start.vy * 0.6 + (dy / dt) * 0.4;
          start.x = event.clientX;
          start.y = event.clientY;
          start.t = event.timeStamp;
          // The tree follows the finger exactly; only the throw glides.
          const units = unitsPerPixel();
          const g = goal.current;
          glide({ ...g, x: g.x - dx * units, y: g.y - dy * units }, true);
        }}
        // The browser took the gesture over to scroll the page (touch-pan-y).
        onPointerCancel={() => (drag.current = null)}
        onPointerUp={(event) => {
          const start = drag.current;
          // Let go while moving and the tree carries on a little, then settles.
          if (start?.moved && event.timeStamp - start.t < 80) {
            const units = unitsPerPixel();
            const g = goal.current;
            glide({ ...g, x: g.x - start.vx * THROW_MS * units, y: g.y - start.vy * THROW_MS * units });
          }
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
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={line.ended ? "5 5" : undefined}
            opacity={line.ended ? 0.7 : 1}
          />
        ))}
        {lines.map((line) => {
          if (!line.label || !line.child) return null;
          const to = layout.positions[line.child];
          const landing = line.landing ?? { x: to.x + NODE_WIDTH / 2, side: "right" };
          return <Label key={`label:${line.key}`} x={landing.x + (landing.side === "left" ? -8 : 8)} y={to.y - 10} text={line.label} anchor={landing.side === "left" ? "end" : "start"} />;
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
              {/* A name on a raised card; hover and focus light its edge in honey. */}
              <rect
                x={at.x}
                y={at.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                strokeWidth={1}
                strokeDasharray={person.deceased ? "4 3" : undefined}
                className={
                  "transition-[stroke] duration-150 group-hover:stroke-accent group-focus-visible:stroke-accent group-focus-visible:[stroke-width:2.5] " +
                  (person.deceased ? "fill-paper stroke-gray-300" : "fill-[var(--raised)] stroke-gray-200")
                }
              />
              <text
                x={at.x + 14}
                y={at.y + NODE_HEIGHT / 2}
                dominantBaseline="central"
                textAnchor="start"
                className={"text-[14px] font-semibold " + (person.deceased ? "fill-gray-500" : "fill-gray-950")}
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
        A couple shares a line, and their children hang from it. The honey
        line is guardianship. Dashed lines have ended (a divorce, a
        guardianship that ran out) and give nobody access. A line that hops
        over another only crosses it. † has died. The number
        in a name&apos;s box is how many papers you can see for them.
      </p>
    </section>
  );
}

function Label({ x, y, text, anchor }: { x: number; y: number; text: string; anchor: "start" | "end" }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="fill-gray-500 text-[11px]">
      {text}
    </text>
  );
}

function Tag({ x, y, tag, more }: { x: number; y: number; tag: MapTag; more: number }) {
  const text = more > 0 ? `${tag.text} +${more}` : tag.text;
  // A soft badge hung over the name, in the state's colour.
  const width = text.length * 6.6 + 20;
  const ink = tag.tone === "warn" ? "var(--warn)" : "var(--soon-ink)";
  return (
    <g aria-hidden="true">
      <rect x={x - width / 2} y={y - 24} width={width} height={22} rx={6} fill="var(--sheet)" />
      <rect x={x - width / 2} y={y - 24} width={width} height={22} rx={6} fill={ink} fillOpacity={0.16} stroke={ink} strokeOpacity={0.35} strokeWidth={1} />
      <text x={x} y={y - 13} dominantBaseline="central" textAnchor="middle" fill={ink} className="text-[11.5px] font-semibold">
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