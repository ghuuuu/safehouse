import { Link } from "react-router";

/**
 * The one way to switch between views of the same page: Individuals or
 * Businesses, Family or Household, One account or Everyone at once. Each
 * option is a link, so the choice lives in the URL and works without script.
 * Drawn as a native segmented control: a recessed track, the current option
 * raised on it. Also a page's tabs (Settings, People, Access): too many to fit
 * a phone and the track scrolls sideways rather than wrapping.
 */
export function Segmented({ label, options }: { label: string; options: { to: string; label: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-gray-100 p-0.5 text-sm [scrollbar-width:none]">
      {options.map((option) => (
        <Link
          key={option.to}
          to={option.to}
          viewTransition
          preventScrollReset
          aria-current={option.current ? "page" : undefined}
          className={
            "shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 font-medium no-underline transition-colors duration-150 pointer-coarse:py-2.5 " +
            (option.current ? "bg-[var(--raised)] text-gray-950 shadow-[var(--shadow-raised)]" : "text-gray-500 hover:text-gray-900")
          }
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
