import { describe, expect, it } from "vitest";

import { requireEnv } from "./config.server";

describe("requireEnv", () => {
  it("returns the value when it is set", () => {
    expect(requireEnv("DATABASE_URL", { DATABASE_URL: "postgres://x" })).toBe(
      "postgres://x",
    );
  });

  it("names the missing variable when it is absent", () => {
    expect(() => requireEnv("DATABASE_URL", {})).toThrow(/DATABASE_URL/);
  });

  it("treats a blank value as missing", () => {
    expect(() => requireEnv("DATABASE_URL", { DATABASE_URL: "   " })).toThrow(
      /DATABASE_URL/,
    );
  });
});
