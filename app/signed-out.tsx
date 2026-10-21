import { Logo } from "./logo";

/**
 * The frame for every page with no sidebar: sign-in, first run, an invite
 * link, an error. The mark and one raised surface holding the page's title and
 * whatever it asks for, on the dark ground with a faint honey glow behind it.
 */
export function SignedOut({ title, children, wide }: { title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center gap-7 overflow-hidden bg-paper px-4 py-10">
      <div
        aria-hidden
        className="absolute left-1/2 top-[28%] -z-10 h-[32rem] w-[48rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--accent) 16%, transparent), transparent)" }}
      />
      <div className="flex flex-col items-center gap-3">
        <Logo size={64} />
        <p className="text-2xl font-semibold tracking-[-0.02em] text-gray-900">SafeHouse</p>
      </div>
      <div className={`sheet flex w-full flex-col gap-6 p-6 md:p-8 ${wide ? "max-w-2xl" : "max-w-md"}`} style={{ boxShadow: "var(--shadow-float)" }}>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        {children}
      </div>
    </main>
  );
}
