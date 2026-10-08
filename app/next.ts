/**
 * Only somewhere inside this application, never somewhere else.
 *
 * `next` arrives in the query string, so it is attacker-controlled: without
 * this a link to `/sign-in?next=https://elsewhere.example` would send somebody
 * away from the vault the moment they typed their password.
 */
export function safeNext(value: FormDataEntryValue | string | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
