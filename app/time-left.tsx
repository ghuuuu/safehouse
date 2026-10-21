/**
 * The time-left ring: how much of the reminder window a paper has left, drawn
 * as a small gauge beside the words that say it. A paper with the whole window
 * ahead of it is nearly a full ring; one running out is a short orange arc; an
 * expired one is an empty red track. Never on its own: the days are always
 * written next to it.
 */
export function TimeLeft({ daysLeft, window, size = 28 }: { daysLeft: number; window: number; size?: number }) {
  const expired = daysLeft < 0;
  const share = Math.max(0.04, Math.min(1, daysLeft / Math.max(1, window)));
  const ink = expired ? "var(--warn)" : "var(--soon)";
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 36 36" className="shrink-0 -rotate-90">
      <circle cx="18" cy="18" r="15" fill="none" stroke={expired ? ink : "var(--g200)"} strokeOpacity={expired ? 0.4 : 1} strokeWidth="3.5" />
      {expired ? null : (
        <circle
          className="ring-arc"
          cx="18"
          cy="18"
          r="15"
          fill="none"
          stroke={ink}
          strokeWidth="3.5"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${share * 100} 100`}
        />
      )}
    </svg>
  );
}
