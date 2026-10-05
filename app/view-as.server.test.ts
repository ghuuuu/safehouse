/**
 * The gate on borrowing somebody else's eyes.
 *
 * View-as works by telling Postgres a different user id, which means the
 * mechanism that renders the vault as Maya is the same mechanism a privilege
 * escalation would use. The only thing between the two is this gate, and it
 * runs before the switch — once the transaction has been opened in the viewed
 * user's name the database has stopped believing the actor is an admin, and
 * `perm.current_user_is_admin()` would answer for the wrong person.
 *
 * These tests need no database because that is the point: the gate reads the
 * actor from the session, never from the impersonated context.
 */

import { describe, expect, test } from "vitest";

import type { SignedInUser } from "./session.server";
import { gateViewAs } from "./view-as.server";

const ADMIN = "00000000-0000-4000-8000-000000000100";
const MAYA = "00000000-0000-4000-8000-000000000101";
const SAM = "00000000-0000-4000-8000-000000000105";

function user(id: string, role: string): SignedInUser {
  return {
    id,
    role,
    email: `${role}@example.invalid`,
    name: "Fixture User",
    personOwnerId: null,
  };
}

/** The status of the refusal, or null if the gate allowed it through. */
function refusalStatus(actor: SignedInUser, requested: string | null) {
  try {
    gateViewAs(actor, requested);
    return null;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    throw thrown;
  }
}

describe("nobody is viewing as anybody", () => {
  test("no request to view as somebody leaves the actor in their own eyes", () => {
    const view = gateViewAs(user(MAYA, "individual"), null);

    expect(view).toEqual({ viewedUserId: MAYA, isViewingAs: false });
  });

  test("an empty parameter is the same as none", () => {
    // `/vault?as=` is what an emptied form field produces. It must not read as
    // "view as the user whose id is the empty string" and fall through to a
    // transaction with no user set.
    expect(gateViewAs(user(MAYA, "individual"), "")).toEqual({
      viewedUserId: MAYA,
      isViewingAs: false,
    });
  });

  test("an admin viewing as themselves is not viewing as anyone", () => {
    // Open question 3 in the spec, answered: no banner, no second context.
    expect(gateViewAs(user(ADMIN, "admin"), ADMIN)).toEqual({
      viewedUserId: ADMIN,
      isViewingAs: false,
    });
  });
});

describe("who may borrow whose eyes", () => {
  test("an admin may view as another user", () => {
    expect(gateViewAs(user(ADMIN, "admin"), MAYA)).toEqual({
      viewedUserId: MAYA,
      isViewingAs: true,
    });
  });

  test.each([
    ["individual", MAYA],
    ["third_party", SAM],
    ["emergency", SAM],
  ])("a %s may not, and is refused rather than ignored", (role, id) => {
    // Refused, not silently downgraded to their own view. A non-admin who
    // discovers the parameter should meet a wall, not a page that looks like
    // it worked — the second teaches them the parameter does nothing, and the
    // first is the truth.
    expect(refusalStatus(user(id, role), ADMIN)).toBe(403);
  });

  test("an unknown role is refused, not treated as an admin", () => {
    // A role added to the enum later, before anybody thinks about this file.
    expect(refusalStatus(user(MAYA, "archivist"), ADMIN)).toBe(403);
  });
});

describe("what the parameter is allowed to contain", () => {
  test.each([
    ["not a uuid", "maya"],
    ["a uuid with something after it", `${MAYA} or true`],
    ["sql", "'; drop table documents; --"],
    ["a near miss", MAYA.slice(0, -1)],
    ["whitespace", "   "],
  ])("%s is refused", (_name, value) => {
    // The value reaches `set_config` as a bound parameter, so this is not the
    // thing standing between the vault and an injection. It is here so that a
    // malformed id fails loudly instead of becoming a transaction with a user
    // nobody can be, which comes back empty and reads like a permission bug.
    expect(refusalStatus(user(ADMIN, "admin"), value)).toBe(400);
  });

  test("a non-admin sending a malformed id is still refused for being a non-admin", () => {
    // Order matters: answering 400 here would tell somebody who may not use
    // this feature at all whether their guess was well formed.
    expect(refusalStatus(user(MAYA, "individual"), "not-a-uuid")).toBe(403);
  });
});
