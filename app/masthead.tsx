/**
 * The head of every signed-in page: the page's name, large, with a quiet line
 * beneath it, and whatever the page puts in `children` (a search box, a
 * button) at the right. It sits on the ground, not in a band: the name does
 * the work.
 */
export function Masthead({
  title,
  serial,
  wide,
  children,
}: {
  title: React.ReactNode;
  serial?: React.ReactNode;
  /** The whole width of the window, for a page that is a dashboard rather than a document. */
  wide?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <header className={`mx-auto flex ${wide ? "max-w-none" : "max-w-6xl"} flex-wrap items-center justify-between gap-x-8 gap-y-4 px-4 pt-4 md:px-8 md:pt-5`}>
      <div className="min-w-0">
        <h1 className="text-[1.875rem] font-semibold leading-[1.1] tracking-[-0.028em] text-balance text-gray-950 md:text-[2.5rem]">
          {title}
        </h1>
        {serial ? <p className="mt-1.5 text-sm text-gray-500">{serial}</p> : null}
      </div>
      {children ? <div className="w-full md:w-auto">{children}</div> : null}
    </header>
  );
}

/**
 * The page under a masthead: the same width and gutters, so a page's work
 * lines up with its name. A narrow page keeps the same left edge and only
 * stops sooner.
 */
export function Page({ children, narrow, wide }: { children: React.ReactNode; narrow?: boolean; wide?: boolean }) {
  return (
    <main className={`mx-auto ${wide ? "max-w-none" : "max-w-6xl"} px-4 py-6 md:px-8 md:py-8`}>
      <div className={`flex flex-col gap-8 ${narrow ? "max-w-3xl" : ""}`}>{children}</div>
    </main>
  );
}

/** Today, the way the page header says it: "Monday 20 October". */
export function todayStamp(date = new Date()): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
