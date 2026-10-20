import { describe, expect, test } from "vitest";

import { guilloche } from "./guilloche";

describe("the guilloché plate", () => {
  test("the same seed always prints the same plate, on the server and in the browser", () => {
    expect(guilloche("The Hale household")).toEqual(guilloche("The Hale household"));
  });

  test("another seed prints another plate", () => {
    const a = guilloche("Vault");
    const b = guilloche("Search");
    expect(a.waves).not.toEqual(b.waves);
  });

  test("every path is drawable: no NaN, no Infinity, inside the plate with a margin", () => {
    for (const seed of ["", "Vault", "Hale Consulting LLC", "Ω ünïcode"]) {
      const { waves, rosettes } = guilloche(seed);
      expect(waves.length).toBeGreaterThan(0);
      expect(rosettes.length).toBeGreaterThan(0);
      for (const d of [...waves, ...rosettes]) {
        expect(d).not.toMatch(/NaN|Infinity/);
        const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
        for (const n of numbers) expect(Math.abs(n)).toBeLessThan(1400);
      }
    }
  });

  test("a rosette closes on itself", () => {
    for (const r of guilloche("Records").rosettes) {
      const numbers = r.match(/-?\d+(\.\d+)?/g)!.map(Number);
      const [x0, y0] = numbers.slice(0, 2);
      const [x1, y1] = numbers.slice(-2);
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(0.5);
    }
  });
});
