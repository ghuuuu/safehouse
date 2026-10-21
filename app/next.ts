/**
 * Only somewhere inside this application, never somewhere else.
 *
 * `next` arrives in the query string, so it is attacker-controlled: without
 * this a link to `/sign-in?next=https://elsewhere.example` would send somebody
 * away from the vault the moment they typed their password.
 *
 * Browsers read "\" as "/" and drop tabs and newlines inside a URL, so
 * "/\evil.example" is "//evil.example" by the time it is followed: a path
 * holding either is refused outright, not tidied.
 */
export function safeNext(value: FormDataEntryValue | string | null, fallback = "/"): string {
  const next = typeof value === "string" ? value : "";
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is being refused
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
