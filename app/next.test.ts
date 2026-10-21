import { expect, test } from "vitest";

import { safeNext } from "./next";

test("a path inside the vault is kept, query and all", () => {
  expect(safeNext("/vault")).toBe("/vault");
  expect(safeNext("/record/abc?as=1#pages")).toBe("/record/abc?as=1#pages");
});

test("anywhere else, or nothing, goes home", () => {
  for (const value of ["https://evil.example", "//evil.example/x", "evil.example", "", null]) {
    expect(safeNext(value)).toBe("/");
  }
});

test("a backslash or a control character cannot turn a path into another site", () => {
  // Browsers read "\" as "/" and drop tabs and newlines inside a URL, so each
  // of these is "//evil.example/x" by the time the browser follows it.
  for (const value of ["/\\evil.example/x", "/\t/evil.example/x", "/\n/evil.example/x", "\\/evil.example/x"]) {
    expect(safeNext(value)).toBe("/");
  }
});

test("a page can say where to go instead of home", () => {
  expect(safeNext("//evil.example", "/vault")).toBe("/vault");
});
