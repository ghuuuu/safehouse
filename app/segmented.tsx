import { Link } from "react-router";

/**
 * The one way to switch between views of the same page: Individuals or
 * Businesses, Family or Household, One account or Everyone at once. Each
 * option is a link, so the choice lives in the URL and works without script.
 * Drawn as a ruled strip, the current option inked in teal.
 */
export function Segmented({ label, options }: { label: string; options: { to: string; label: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex w-fit divide-x divide-gray-300 rounded-md border border-gray-300 bg-white text-sm">
      {options.map((option) => (
        <Link
          key={option.to}
          to={option.to}
          aria-current={option.current ? "page" : undefined}
          className={
            "px-4 py-2 font-medium first:rounded-l-[2px] last:rounded-r-[2px] pointer-coarse:py-2.5 " +
            (option.current ? "bg-accent text-on-accent" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900")
          }
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
