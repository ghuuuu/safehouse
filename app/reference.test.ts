import { describe, expect, test } from "vitest";

import { reference } from "./reference";

describe("a paper's reference", () => {
  test("is its category and eight hex digits, the same every time", () => {
    const id = "00000000-0000-4000-8000-000000000012";
    expect(reference("personal", id)).toMatch(/^PER-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(reference("personal", id)).toBe(reference("personal", id));
  });

  test("neighbouring ids do not print neighbouring references, so nothing counts", () => {
    const a = reference("legal", "00000000-0000-4000-8000-000000000012");
    const b = reference("legal", "00000000-0000-4000-8000-000000000013");
    expect(a).not.toBe(b);
    expect(a.slice(4, 8)).not.toBe(b.slice(4, 8));
  });

  test("an unknown category still prints", () => {
    expect(reference("mystery", "x")).toMatch(/^DOC-/);
  });
});
