/**
 * Where each person goes in the picture. Pure, so it is tested without a
 * browser and runs the same on the server and in the page.
 *
 * Rows are generations: a person sits one row below their lowest parent, and
 * spouses share a row. Within a row, people are ordered under their parents and
 * spouses are kept together. A family tree is not a hierarchy (a child can have
 * three parents, and a parent two spouses), so there is no library shape to
 * borrow here that fits better than this.
 *
 * ponytail: ordering within a row is a heuristic (the average position of the
 * parents), so a large blended family can draw crossing lines. If that becomes
 * a real problem, the upgrade is a layered-graph layout such as elkjs, which is
 * a new dependency to ask about first.
 */

import type { TreeEdge, TreePerson } from "./tree";

export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 52;
const GAP_X = 64;
const GAP_Y = 96;

export type Layout = {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
};

export function layoutTree(people: TreePerson[], edges: TreeEdge[]): Layout {
  if (people.length === 0) return { positions: {}, width: 0, height: 0 };

  // Sorted first, so the same household always comes out the same way
  // whatever order the database returned it in.
  const ids = people.map((p) => p.ownerId).sort();
  const parentsOf = new Map(ids.map((id) => [id, [] as string[]]));
  const spousesOf = new Map(ids.map((id) => [id, [] as string[]]));

  for (const edge of [...edges].sort(byEnds)) {
    if (!parentsOf.has(edge.from) || !parentsOf.has(edge.to)) continue;
    if (edge.kind === "parent_of") parentsOf.get(edge.to)!.push(edge.from);
    else {
      spousesOf.get(edge.from)!.push(edge.to);
      spousesOf.get(edge.to)!.push(edge.from);
    }
  }

  // Generations, raised until nothing changes. Both rules only ever raise a
  // number, so good data settles. Bad data (somebody their own ancestor) never
  // would, which is what the cap is for: it still places everybody.
  const row = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0, changed = true; changed && pass < ids.length * 2; pass++) {
    changed = false;
    for (const id of ids) {
      const below = Math.max(
        row.get(id)!,
        ...parentsOf.get(id)!.map((parent) => row.get(parent)! + 1),
        ...spousesOf.get(id)!.map((spouse) => row.get(spouse)!),
      );
      if (below !== row.get(id)) {
        row.set(id, below);
        changed = true;
      }
    }
  }

  const rowCount = Math.max(...row.values()) + 1;
  const slot = new Map<string, number>();
  const rows: string[][] = [];

  for (let r = 0; r < rowCount; r++) {
    const here = ids.filter((id) => row.get(id) === r);

    // Under the parents where there are any. Nobody-at-all goes last, so a
    // person with no relationships does not sit between a couple.
    const key = (id: string) => {
      const placed = parentsOf.get(id)!.filter((p) => slot.has(p));
      if (placed.length > 0) return placed.reduce((sum, p) => sum + slot.get(p)!, 0) / placed.length;
      const related = spousesOf.get(id)!.length > 0 || hasChildren(id, parentsOf);
      return related ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER;
    };
    here.sort((a, b) => key(a) - key(b) || a.localeCompare(b));

    // Then each person is followed by their spouses, and theirs, so a couple
    // (or a remarriage chain) is never split by somebody else.
    const ordered: string[] = [];
    for (const id of here) {
      const chain = [id];
      for (let i = 0; i < chain.length; i++) {
        if (ordered.includes(chain[i])) continue;
        ordered.push(chain[i]);
        chain.push(...spousesOf.get(chain[i])!.filter((s) => row.get(s) === r));
      }
    }

    ordered.forEach((id, i) => slot.set(id, i));
    rows.push(ordered);
  }

  const widest = Math.max(...rows.map((r) => r.length));
  const width = widest * NODE_WIDTH + (widest - 1) * GAP_X;
  const positions: Layout["positions"] = {};

  rows.forEach((members, r) => {
    // Each row centred under the widest.
    const rowWidth = members.length * NODE_WIDTH + (members.length - 1) * GAP_X;
    const left = (width - rowWidth) / 2;
    members.forEach((id, i) => {
      positions[id] = { x: left + i * (NODE_WIDTH + GAP_X), y: r * (NODE_HEIGHT + GAP_Y) };
    });
  });

  return { positions, width, height: rowCount * NODE_HEIGHT + (rowCount - 1) * GAP_Y };
}

function hasChildren(id: string, parentsOf: Map<string, string[]>): boolean {
  for (const parents of parentsOf.values()) if (parents.includes(id)) return true;
  return false;
}

function byEnds(a: TreeEdge, b: TreeEdge): number {
  return a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
}
