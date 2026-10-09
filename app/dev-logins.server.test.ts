import { describe, expect, test } from "vitest";

import { DEV_LOGINS, devLoginFor, devLoginsEnabled } from "./dev-logins.server";

describe("the one-click sign-ins", () => {
  test("are off in a production build, whatever the database", () => {
    expect(devLoginsEnabled("postgres://u:p@127.0.0.1:5435/safehouse", false)).toBe(false);
  });

  test("are off against a database that is not on this machine", () => {
    expect(devLoginsEnabled("postgres://u:p@db.example.com:5432/safehouse", true)).toBe(false);
    expect(devLoginsEnabled("postgres://u:p@db:5432/safehouse", true)).toBe(false);
  });

  test("are off with no database, or one that is not a URL", () => {
    expect(devLoginsEnabled("", true)).toBe(false);
    expect(devLoginsEnabled("not a url", true)).toBe(false);
  });

  test("are on in development against this machine", () => {
    expect(devLoginsEnabled("postgres://u:p@127.0.0.1:5435/safehouse", true)).toBe(true);
    expect(devLoginsEnabled("postgres://u:p@localhost:5435/safehouse", true)).toBe(true);
  });

  test("cover every role, and only fictional accounts", () => {
    expect(new Set(DEV_LOGINS.map((l) => l.role))).toEqual(
      new Set(["Administrator", "Household member", "Third party", "Emergency contact"]),
    );
    for (const login of DEV_LOGINS) expect(login.email).toMatch(/@example\.invalid$/);
  });

  test("will not sign in as an address that is not on the list", () => {
    expect(devLoginFor("priya@example.invalid")?.name).toBe("Priya Raman");
    expect(devLoginFor("someone@real-family.com")).toBeNull();
    expect(devLoginFor("")).toBeNull();
  });
});
