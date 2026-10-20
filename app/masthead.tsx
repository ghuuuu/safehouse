import { useMemo } from "react";

import { guilloche, PLATE_HEIGHT, PLATE_WIDTH } from "./guilloche";

/**
 * The band across the top of every signed-in page: the page's name, a gold
 * serial line printed under it, and its guilloché plate behind them.
 * Whatever the page puts in `children` (a search box, a button) sits at the
 * right, over the rosette.
 *
 * The plate is seeded by `seed`, the page's own name unless it says
 * otherwise, so each page prints its own, the same every time.
 */
export function Masthead({
  title,
  serial,
  seed,
  children,
}: {
  title: React.ReactNode;
  serial?: React.ReactNode;
  seed?: string;
  children?: React.ReactNode;
}) {
  const plate = useMemo(() => guilloche(seed ?? (typeof title === "string" ? title : "Safehouse")), [seed, title]);

  return (
    <header className="relative isolate overflow-hidden bg-side-deep text-side-on">
      <svg
        aria-hidden
        viewBox={`0 0 ${PLATE_WIDTH} ${PLATE_HEIGHT}`}
        preserveAspectRatio="xMaxYMid slice"
        className="plate-ink absolute inset-0 -z-10 h-full w-full"
        fill="none"
        stroke="var(--plate)"
        strokeWidth={0.75}
      >
        {plate.waves.map((d, i) => (
          <path key={`w${i}`} d={d} pathLength={1} opacity={0.75} vectorEffect="non-scaling-stroke" />
        ))}
        {plate.rosettes.map((d, i) => (
          <path key={`r${i}`} d={d} pathLength={1} opacity={0.9} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {/* The words sit on a quieter field, so the plate never fights them. */}
      <div aria-hidden className="absolute inset-y-0 left-0 -z-10 w-full bg-linear-to-r from-side-deep via-side-deep/85 to-transparent md:w-2/3" />
      <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 pb-6 pt-7 md:px-8 md:pb-8 md:pt-10">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-balance md:text-[2.25rem]">{title}</h1>
          {serial ? <p className="mt-2 font-mono text-xs font-medium tracking-[0.12em] text-serial uppercase">{serial}</p> : null}
        </div>
        {children ? <div className="w-full md:w-auto">{children}</div> : null}
      </div>
    </header>
  );
}

/**
 * The page under a masthead: the same width and gutters, so a page's work
 * lines up with its name. A narrow page keeps the same left edge and only
 * stops sooner, the way a form sits flush with its letterhead.
 */
export function Page({ children, narrow }: { children: React.ReactNode; narrow?: boolean }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <div className={`flex flex-col gap-8 ${narrow ? "max-w-3xl" : ""}`}>{children}</div>
    </main>
  );
}

/** Today, as the serial line prints it: "SAT 18 OCT 2026". */
export function todayStamp(date = new Date()): string {
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}
