import { Link } from "react-router";

/**
 * The one way to switch between views of the same page: Individuals or
 * Businesses, Family or Household, One account or Everyone at once. Each
 * option is a link, so the choice lives in the URL and works without script.
 */
export function Segmented({ label, options }: { label: string; options: { to: string; label: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex w-fit rounded-lg border border-gray-200 p-1 text-sm">
      {options.map((option) => (
        <Link
          key={option.to}
          to={option.to}
          aria-current={option.current ? "page" : undefined}
          className={
            "rounded-md px-4 py-1.5 pointer-coarse:py-2.5 " +
            (option.current ? "bg-accent text-on-accent" : "text-gray-600 hover:bg-gray-100")
          }
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
