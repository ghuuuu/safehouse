/**
 * The mark: a house that is a safe, its door a combination dial, from
 * `public/logo/SH-logo.svg`, recoloured into the night: a honey shell, the
 * door in the sheet's grey, the dial honey on raised grey, every line in
 * honey ink. The original navy and orange are in `design/`.
 */
const TICKS = [
  [34.81, 57.53, 34.81, 54.63], [25.37, 53.62, 27.42, 51.57], [21.46, 44.18, 24.35, 44.18], [25.37, 34.74, 27.42, 36.78],
  [34.81, 30.82, 34.81, 33.72], [44.25, 34.73, 42.2, 36.78], [48.17, 44.18, 45.27, 44.18], [44.25, 53.62, 42.21, 51.57],
  [40.36, 57.56, 39.25, 54.89], [29.27, 57.56, 30.38, 54.89], [21.43, 49.72, 24.1, 48.61], [21.43, 38.63, 24.1, 39.74],
  [29.27, 30.79, 30.38, 33.47], [40.36, 30.79, 39.25, 33.47], [48.2, 38.63, 45.52, 39.74], [48.2, 49.72, 45.52, 48.61],
];

export function Logo({ size = 28 }: { size?: number }) {
  const line = { stroke: "var(--on-accent)", strokeMiterlimit: 10, strokeWidth: 2 };
  return (
    <svg width={(size * 69.7) / 75.12} height={size} viewBox="0 0 69.7 75.12" aria-hidden="true" className="shrink-0">
      <path d="M0,66.61V28.55c0-2.66,1.24-5.16,3.35-6.77L29.7,1.74c3.04-2.31,7.26-2.31,10.3,0l26.35,20.04c2.11,1.61,3.35,4.11,3.35,6.77v38.06c0,4.7-3.81,8.5-8.5,8.5H8.5c-4.7,0-8.5-3.81-8.5-8.5Z" fill="var(--accent)" />
      <path d="M7.09,62.36v-31.7c0-1.77.83-3.44,2.24-4.51L31.42,9.33c2.03-1.54,4.84-1.54,6.87,0l22.09,16.81c1.41,1.07,2.24,2.74,2.24,4.51v31.71c0,3.13-2.54,5.67-5.67,5.67H12.76c-3.13,0-5.67-2.54-5.67-5.67Z" fill="var(--sheet)" {...line} />
      <circle cx="34.85" cy="44.18" r="14.17" fill="var(--accent)" {...line} />
      <circle cx="34.85" cy="44.18" r="8.5" fill="var(--raised)" {...line} />
      <path d="M36.54,42.49c-.17-.42-.25-.76-.33-1.1.27-.24.89-.88,1.15-1.14.25-.25.9-.9,1.15-1.15.34.09.68.17,1.09.33.16.41.24.75.33,1.09-.24.24-.9.9-1.15,1.15-.26.27-.9.88-1.14,1.15-.34-.08-.67-.16-1.1-.33h0Z" fill="var(--accent)" />
      {TICKS.map(([x1, y1, x2, y2]) => (
        <line key={`${x1},${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} {...line} strokeWidth={1.5} />
      ))}
      <rect x="60.49" y="50.77" width="4.25" height="11.34" rx="1.98" fill="var(--accent)" {...line} />
      <rect x="60.49" y="33.77" width="4.25" height="11.34" rx="1.98" fill="var(--accent)" {...line} />
    </svg>
  );
}
