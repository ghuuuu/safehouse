import { useRef, useState } from "react";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/intake.$intakeId.corners.$pageId";
import { loadIntake, setPage, type Outline } from "../intake.server";
import { Masthead, Page } from "../masthead";
import { ordered, type Corners } from "../paper.server";
import { withVault } from "../session.server";
import { requireStepUp } from "../stepup.server";

export function meta() {
  return [{ title: "Adjust the corners — SafeHouse" }];
}

/**
 * Put a photo's four corners on the paper's own corners, so it is flattened
 * onto the right shape (D39). The handles work in the photo's own upright
 * pixels: the picture is drawn into an SVG of exactly that size, so where a
 * handle sits on screen is where the corner is, with no scale to get wrong.
 *
 * How it enforces access: as the review screen, `withVault` and the intake
 * policies (D40), then a recent password check before the photo is shown.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    await requireStepUp(request, user);
    const intake = await loadIntake(db, params.intakeId);
    const page = intake?.pages.find((p) => p.id === params.pageId && p.kind === "photo");
    if (!intake || !page?.corners) throw new Response("No such page.", { status: 404 });
    return { intakeId: intake.id, pageId: page.id, outline: page.corners, n: intake.pages.indexOf(page) + 1 };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const numbers = String(form.get("corners") ?? "").split(",").map(Number);

  await withVault(request, async (db) => {
    const intake = await loadIntake(db, params.intakeId);
    const outline = intake?.pages.find((p) => p.id === params.pageId)?.corners;
    if (!outline) throw new Response("No such page.", { status: 404 });

    // Kept inside the photo, and put in order, whatever was posted.
    const inside = (v: number, max: number) => Math.min(max, Math.max(0, Number.isFinite(v) ? v : 0));
    if (numbers.length !== 8) throw new Response("Four corners.", { status: 400 });
    const points = [0, 1, 2, 3].map((i) => [inside(numbers[i * 2], outline.width), inside(numbers[i * 2 + 1], outline.height)] as [number, number]);
    await setPage(db, params.pageId, { corners: { ...outline, points: ordered(points), found: true } satisfies Outline });
  });

  return redirect(`/intake/${params.intakeId}`);
}

const NAMES = ["Top left", "Top right", "Bottom right", "Bottom left"];

export default function CornerEditor({ loaderData }: Route.ComponentProps) {
  const { intakeId, pageId, outline, n } = loaderData;
  const { width, height } = outline;
  const [points, setPoints] = useState<Corners>(outline.points);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const handle = Math.max(width, height) / 45;

  const clamp = (x: number, y: number): [number, number] => [Math.min(width, Math.max(0, x)), Math.min(height, Math.max(0, y))];
  const move = (i: number, x: number, y: number) =>
    setPoints((current) => current.map((p, k) => (k === i ? clamp(x, y) : p)) as Corners);

  const toPhoto = (event: React.PointerEvent): [number, number] => {
    const matrix = svg.current!.getScreenCTM()!.inverse();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    return [point.x, point.y];
  };

  return (
    <>
      <Masthead title={`Corners of page ${n}`} />
      <Page>
        <p className="-mb-2 max-w-prose text-base text-gray-700">
          Drag each square onto a corner of the paper, or pick a square and use the arrow keys (Shift for small
          steps). The page is flattened onto this shape at its real size.
        </p>

        <div className="sheet overflow-hidden p-2">
          <svg
            ref={svg}
            viewBox={`0 0 ${width} ${height}`}
            className="mx-auto block max-h-[70vh] w-full touch-none select-none"
            onPointerMove={(e) => dragging.current !== null && move(dragging.current, ...toPhoto(e))}
            onPointerUp={() => (dragging.current = null)}
            onPointerLeave={() => (dragging.current = null)}
          >
            <image href={`/intake/${intakeId}/page/${pageId}?view=photo&max=1600`} width={width} height={height} />
            <polygon
              points={points.map((p) => p.join(",")).join(" ")}
              fill="var(--accent)"
              fillOpacity={0.12}
              stroke="var(--accent)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {points.map(([x, y], i) => (
              <rect
                key={i}
                role="slider"
                tabIndex={0}
                aria-label={`${NAMES[i]} corner`}
                aria-valuetext={`${Math.round((x / width) * 100)}% across, ${Math.round((y / height) * 100)}% down`}
                x={x - handle / 2}
                y={y - handle / 2}
                width={handle}
                height={handle}
                rx={handle / 12}
                fill="var(--sheet)"
                stroke="var(--accent)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                className="cursor-move"
                onPointerDown={(e) => {
                  dragging.current = i;
                  (e.target as Element).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => dragging.current === i && move(i, ...toPhoto(e))}
                onPointerUp={() => (dragging.current = null)}
                onKeyDown={(e) => {
                  const step = (e.shiftKey ? 0.002 : 0.01) * Math.max(width, height);
                  const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                  if (!by) return;
                  e.preventDefault();
                  move(i, x + by[0], y + by[1]);
                }}
              />
            ))}
          </svg>
        </div>

        <Form method="post" className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="corners" value={points.flat().map((v) => Math.round(v)).join(",")} />
          <button type="submit" className="btn btn-primary">Use these corners</button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPoints([[0, 0], [width, 0], [width, height], [0, height]])}
          >
            The whole photo
          </button>
          <Link className="py-2 text-sm text-gray-500 underline hover:text-gray-900" to={`/intake/${intakeId}`}>
            Cancel
          </Link>
        </Form>
      </Page>
    </>
  );
}
