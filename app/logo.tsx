/**
 * The mark: a house whose door is a keyhole, engraved inside a double-ruled
 * seal. Gold on teal by default; it draws in lines, so it sits on any ground.
 */
export function Logo({ size = 30, ink = "var(--serial)" }: { size?: number; ink?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0" fill="none" stroke={ink}>
      <circle cx="16" cy="16" r="15" strokeWidth="1" />
      <circle cx="16" cy="16" r="12.5" strokeWidth="0.6" />
      <path d="M8.5 15.5 16 9l7.5 6.5V23h-15z" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="16" cy="16.6" r="1.6" fill={ink} stroke="none" />
      <path d="M15.2 17.6h1.6l.5 3.4h-2.6z" fill={ink} stroke="none" />
    </svg>
  );
}
