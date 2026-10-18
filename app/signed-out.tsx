import { guilloche, PLATE_HEIGHT, PLATE_WIDTH } from "./guilloche";
import { Logo } from "./logo";

// One seed for every signed-out page, so the door always prints the same plate.
const plate = guilloche("Safehouse");

/**
 * The frame for every page with no sidebar: sign-in, first run, an invite
 * link, an error. Deep teal with the plate faint behind it, the mark, and one
 * sheet holding the page's title and whatever it asks for.
 */
export function SignedOut({ title, children, wide }: { title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-side-deep px-4 py-10">
      <svg
        aria-hidden
        viewBox={`0 0 ${PLATE_WIDTH} ${PLATE_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        className="plate-ink absolute inset-0 -z-10 h-full w-full opacity-40"
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
      <div className="flex flex-col items-center gap-3">
        <Logo size={48} />
        <p className="text-sm font-semibold tracking-[0.32em] text-side-ink uppercase">Safehouse</p>
      </div>
      <div className={`sheet flex w-full flex-col gap-6 p-6 md:p-8 ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}
