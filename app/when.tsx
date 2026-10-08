/**
 * Dates, written one way everywhere: "31 January 2029".
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A calendar date from "2029-01-31". By hand rather than `toLocaleString`,
 * so the server and the browser print the same thing.
 */
export function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * A moment, in the reader's own time zone, as a long date and a time.
 *
 * The server and the browser format a date differently (different zone,
 * different locale), so the text is allowed to differ at hydration: the server
 * renders its guess, the browser corrects it, and React is told that is fine.
 */
export function When({ at }: { at: string | Date }) {
  const date = new Date(at);
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {date.toLocaleString(undefined, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}
