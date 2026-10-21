/**
 * Password tries, counted per account (audit, 2026-10-21).
 *
 * Per account rather than per address: nothing in front of this server can
 * vouch for an address, so a client guessing passwords would name a new one in
 * X-Forwarded-For on every try. The cost of counting per account is that
 * somebody guessing at an account shuts its owner out with them until the
 * window passes. For a vault, locked is the right way to fail.
 *
 * A try is spent before the password is checked, not after it fails, so a
 * burst of guesses sent at once cannot all start before any of them counts.
 *
 * In memory: one container, and a restart forgets — which nobody outside can
 * cause. The password itself is still checked by the library; this only
 * decides whether it gets asked.
 */

/** Wrong passwords allowed per account per window. */
export const TRIES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

type Tally = { count: number; since: number };

const tallies = new Map<string, Tally>();

function live(key: string, now: number): Tally | undefined {
  const tally = tallies.get(key);
  if (tally && now - tally.since >= WINDOW_MS) tallies.delete(key);
  return tallies.get(key);
}

/** Spend one try on this account. False when it has none left. */
export function spendTry(key: string, now = Date.now()): boolean {
  const tally = live(key, now) ?? { count: 0, since: now };
  if (tally.count >= TRIES) return false;
  tally.count += 1;
  tallies.set(key, tally);
  // ponytail: a sweep on every write, O(accounts guessed at); fine for a
  // household, a timed sweep if somebody sprays thousands of addresses.
  for (const other of tallies.keys()) live(other, now);
  return true;
}

/** The right password: the count starts again. */
export function forgetTries(key: string): void {
  tallies.delete(key);
}

export const TOO_MANY_TRIES = "Too many wrong passwords for this account. Wait a quarter of an hour, then try again.";
