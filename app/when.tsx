/**
 * A moment, in the reader's own time zone and format.
 *
 * The server and the browser format a date differently (different zone,
 * different locale), so the text is allowed to differ at hydration: the server
 * renders its guess, the browser corrects it, and React is told that is fine.
 */
export function When({ at }: { at: string | Date }) {
  const date = new Date(at);
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {date.toLocaleString()}
    </time>
  );
}
