/**
 * The mark: a house whose door is a keyhole. Amber on plum by default; the
 * keyhole is cut out in whatever the logo sits on.
 */
export function Logo({ size = 28, hole = "var(--side)" }: { size?: number; hole?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" className="shrink-0">
      <path d="M3 14 L15 3 L27 14 V27 H3 Z" fill="var(--logo)" stroke="var(--logo)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="15" cy="16" r="3" fill={hole} />
      <path d="M13.3 17.5 H16.7 L17.5 24 H12.5 Z" fill={hole} />
    </svg>
  );
}
