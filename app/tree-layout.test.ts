import { describe, expect, test } from "vitest";

import type { TreeEdge, TreePerson } from "./tree";
import { layoutTree } from "./tree-layout";

/** The fixture household's shape, by name, with no database involved. */
const NAMES = ["rose", "frank", "maya", "daniel", "ivy", "theo", "nadia", "omar", "lena", "bram", "priya"];
const PEOPLE: TreePerson[] = NAMES.map((name) => ({
  ownerId: name,
  name,
  deceased: name === "frank",
  sex: null,
}));

const parent = (from: string, to: string, ended = false): TreeEdge => ({
  from, to, kind: "parent_of", parentType: "biological", ended,
});
const spouse = (from: string, to: string, ended = false): TreeEdge => ({
  from, to, kind: "spouse_of", parentType: null, ended,
});

const EDGES: TreeEdge[] = [
  spouse("rose", "frank"),
  spouse("daniel", "maya"),
  spouse("daniel", "nadia", true),
  parent("rose", "maya"),
  parent("frank", "maya"),
  parent("omar", "nadia"),
  parent("maya", "ivy"),
  parent("daniel", "ivy"),
  parent("daniel", "theo"),
  parent("nadia", "theo"),
  parent("maya", "theo"),
  parent("rose", "lena"),
  parent("rose", "bram", true),
];

describe("the fixture household", () => {
  const { positions } = layoutTree(PEOPLE, EDGES);
  const row = (id: string) => positions[id].y;

  test("every parent is on a row above every child", () => {
    for (const edge of EDGES.filter((e) => e.kind === "parent_of")) {
      expect(row(edge.from), `${edge.from} above ${edge.to}`).toBeLessThan(row(edge.to));
    }
  });

  test("spouses share a row and stand next to each other", () => {
    for (const [a, b] of [["rose", "frank"], ["daniel", "maya"]]) {
      expect(row(a)).toBe(row(b));

      const between = PEOPLE.filter(
        (p) => row(p.ownerId) === row(a) &&
          positions[p.ownerId].x > Math.min(positions[a].x, positions[b].x) &&
          positions[p.ownerId].x < Math.max(positions[a].x, positions[b].x),
      );
      expect(between.map((p) => p.ownerId), `${a} and ${b} adjacent`).toEqual([]);
    }
  });

  test("somebody with no relationships is placed, not dropped", () => {
    expect(positions.priya).toBeDefined();
    expect(Object.keys(positions).sort()).toEqual([...NAMES].sort());
  });

  test("no two people share a spot", () => {
    const spots = Object.values(positions).map((p) => `${p.x},${p.y}`);
    expect(new Set(spots).size).toBe(spots.length);
  });
});

test("the same household always lays out the same way", () => {
  const shuffled = [...PEOPLE].reverse();
  const shuffledEdges = [...EDGES].reverse();

  expect(layoutTree(shuffled, shuffledEdges)).toEqual(layoutTree(PEOPLE, EDGES));
});

test("a cycle in bad data still finishes, and places everybody", () => {
  const people = ["a", "b", "c"].map((id) => ({ ownerId: id, name: id, deceased: false, sex: null }));
  const edges = [parent("a", "b"), parent("b", "c"), parent("c", "a"), spouse("a", "c")];

  const { positions } = layoutTree(people, edges);
  expect(Object.keys(positions).sort()).toEqual(["a", "b", "c"]);
});

test("an empty tree is an empty picture", () => {
  expect(layoutTree([], [])).toEqual({ positions: {}, width: 0, height: 0 });
});
