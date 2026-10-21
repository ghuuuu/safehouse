/**
 * The app's icons: drawn here, one 20px grid, one 1.6 stroke, round ends.
 * Decorative: whatever an icon sits beside always says the same in words.
 */

const PATHS = {
  home: "M3.5 9.2 10 3.8l6.5 5.4V16a1 1 0 0 1-1 1h-3.2v-4.5H7.7V17H4.5a1 1 0 0 1-1-1z",
  vault: "M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v2H3zM4 7.5h12V15a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15zM8 10.5h4",
  folder: "M2.8 6A1.5 1.5 0 0 1 4.3 4.5h3.2l1.6 1.8h6.6a1.5 1.5 0 0 1 1.5 1.5V15a1.5 1.5 0 0 1-1.5 1.5H4.3A1.5 1.5 0 0 1 2.8 15z",
  search: "M8.8 15a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4zM13.3 13.3 17.2 17.2",
  tree: "M10 3.5v4M10 7.5H5v3M10 7.5h5v3M5 10.5v2M15 10.5v2M3.5 12.5h3v3h-3zM13.5 12.5h3v3h-3zM8.5 2h3v3h-3z",
  file: "M10 4v12M4 10h12",
  many: "M5 3.5h8.5L16 6v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5zM7 9.5h6M7 12.5h6",
  unfinished: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6.5V10l2.5 1.5",
  people: "M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 16.5c.6-2.7 2.6-4.3 5-4.3s4.4 1.6 5 4.3M13 4a2.6 2.6 0 0 1 0 5.2M14.5 12.4c1.6.4 2.6 1.8 3 4.1",
  access: "M12.8 8.7a4.2 4.2 0 1 0-3.6 3.6l1 1h1.6v1.6h1.6V16.5h2.8v-2.8z",
  settings:
    "M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM10 2.5v2M10 15.5v2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M2.5 10h2M15.5 10h2M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4",
  more: "M4.5 10h.01M10 10h.01M15.5 10h.01",
  next: "M8 4.5 13.5 10 8 15.5",
  back: "M12 4.5 6.5 10l5.5 5.5",
  out: "M8 4H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16h3M12.5 13.5 16 10l-3.5-3.5M16 10H8",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 2.6 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
