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

export const NODE_WIDTH = 144;
export const NODE_HEIGHT = 40;
const GAP_X = 48;
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

  // Across: each person as near as they can be to the middle of their own
  // parents (blood or adoptive first, then anybody who raised them), so a
  // child stands under the couple they hang from. Nobody with parents above
  // follows whoever is before them. Then a sweep keeps every pair apart.
  const raisedBy = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    if (edge.kind === "parent_of" && raisedBy.has(edge.to) && edge.parentType !== "step" && edge.parentType !== "guardian") {
      raisedBy.get(edge.to)!.push(edge.from);
    }
  }
  const x = new Map<string, number>();
  const step = NODE_WIDTH + GAP_X;
  for (const members of rows) {
    let previous = -Infinity;
    for (const id of members) {
      const own = raisedBy.get(id)!.filter((p) => x.has(p));
      const any = parentsOf.get(id)!.filter((p) => x.has(p));
      const from = own.length > 0 ? own : any;
      const wanted = from.length > 0 ? from.reduce((sum, p) => sum + x.get(p)!, 0) / from.length : previous + step;
      // A spouse with no parents of their own stands right beside their partner.
      const at = Math.max(Number.isFinite(wanted) ? wanted : 0, previous + step);
      x.set(id, at);
      previous = at;
    }
  }

  // Back up: somebody at the top with no partner and no parents of their own
  // stands over their children, so their line drops straight down instead of
  // crossing another family's. The rest of their row keeps its order.
  for (let r = rows.length - 2; r >= 0; r--) {
    const members = rows[r];
    const wanted = new Map(members.map((id) => [id, x.get(id)!]));
    for (const id of members) {
      const children = ids.filter((c) => parentsOf.get(c)!.includes(id));
      if (spousesOf.get(id)!.length > 0 || parentsOf.get(id)!.length > 0) continue;
      // Nobody-at-all still goes last, as on the way down.
      if (children.length === 0) wanted.set(id, Infinity);
      else wanted.set(id, children.reduce((sum, c) => sum + x.get(c)!, 0) / children.length);
    }
    members.sort((a, b) => wanted.get(a)! - wanted.get(b)!);
    let previous = -Infinity;
    for (const id of members) {
      const w = wanted.get(id)!;
      const at = Number.isFinite(w) ? Math.max(w, previous + step) : previous + step;
      x.set(id, at);
      previous = at;
    }
  }

  const left = Math.min(...x.values());
  const positions: Layout["positions"] = {};
  rows.forEach((members, r) => {
    for (const id of members) positions[id] = { x: x.get(id)! - left, y: r * (NODE_HEIGHT + GAP_Y) };
  });
  const width = Math.max(...[...x.values()].map((v) => v - left)) + NODE_WIDTH;

  return { positions, width, height: rowCount * NODE_HEIGHT + (rowCount - 1) * GAP_Y };
}

function hasChildren(id: string, parentsOf: Map<string, string[]>): boolean {
  for (const parents of parentsOf.values()) if (parents.includes(id)) return true;
  return false;
}

function byEnds(a: TreeEdge, b: TreeEdge): number {
  return a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
}

/** A family's colour: one of five transit inks, or amber for guardianship. */
export type LineColour = "line-1" | "line-2" | "line-3" | "line-4" | "line-5" | "guardian";

export type FamilyLine = {
  key: string;
  /** SVG path, in the layout's coordinates. */
  d: string;
  colour: LineColour;
  /** A divorce, or a guardianship that ran out (D33): drawn dotted. */
  ended: boolean;
  /** For a child's line, who it leads to. */
  child?: string;
  label?: string;
};

const INKS: LineColour[] = ["line-1", "line-2", "line-3", "line-4", "line-5"];

/**
 * The tree's lines, the way a metro map draws them. A couple is one line in
 * one colour; a child of that couple hangs from the middle of it, in the same
 * colour, so a family reads as one route. A guardian, a step-parent, or a
 * parent with no partner on the tree draws a line of their own. Each line
 * down to a row runs across at its own height, so two families' lines never
 * merge into one nobody can trace.
 */
export function familyLines(edges: TreeEdge[], layout: Layout): FamilyLine[] {
  const at = layout.positions;
  const sorted = [...edges].filter((e) => at[e.from] && at[e.to]).sort(byEnds);
  const lines: FamilyLine[] = [];
  const colourOf = new Map<string, LineColour>();
  let next = 0;
  const fresh = () => INKS[next++ % INKS.length];

  // Couples first: each spouse edge is a family with its own colour.
  const couples = new Map<string, { colour: LineColour; midX: number; y: number; ended: boolean }>();
  for (const edge of sorted.filter((e) => e.kind === "spouse_of")) {
    const [a, b] = [edge.from, edge.to].sort();
    const [left, right] = at[a].x < at[b].x ? [at[a], at[b]] : [at[b], at[a]];
    const colour = fresh();
    const y = left.y + NODE_HEIGHT / 2;
    couples.set(`${a}:${b}`, { colour, midX: (left.x + NODE_WIDTH + right.x) / 2, y, ended: edge.ended });
    for (const id of [a, b]) if (!colourOf.has(id)) colourOf.set(id, colour);
    lines.push({ key: `couple:${a}:${b}`, d: `M ${left.x + NODE_WIDTH} ${y} H ${right.x}`, colour, ended: edge.ended });
  }

  // Each source of a line down gets its own lane within its row.
  const lanes = new Map<string, number>();
  const laneY = (source: string, fromBottom: number, toTop: number, row: number) => {
    if (!lanes.has(source)) lanes.set(source, [...lanes.keys()].filter((k) => k.endsWith(`@${row}`)).length);
    return (fromBottom + toTop) / 2 + ((lanes.get(source)! % 4) - 1.5) * 9;
  };

  const blood = (e: TreeEdge) => e.kind === "parent_of" && (e.parentType === "biological" || e.parentType === "adoptive" || e.parentType === null);
  const children = [...new Set(sorted.filter((e) => e.kind === "parent_of").map((e) => e.to))];
  const covered = new Set<TreeEdge>();

  for (const child of children) {
    const parents = sorted.filter((e) => e.to === child && blood(e));
    const couple = parents.length === 2 ? couples.get(parents.map((e) => e.from).sort().join(":")) : undefined;
    if (!couple) continue;
    parents.forEach((e) => covered.add(e));
    const top = at[child].y;
    const y = laneY(`${parents.map((e) => e.from).sort().join(":")}@${couple.y}`, couple.y, top, couple.y);
    const x = at[child].x + NODE_WIDTH / 2;
    lines.push({ key: `child:${child}`, child, colour: couple.colour, ended: false, d: `M ${couple.midX} ${couple.y} V ${y} H ${x} V ${top}` });
  }

  for (const edge of sorted.filter((e) => e.kind === "parent_of" && !covered.has(e))) {
    const from = at[edge.from];
    const to = at[edge.to];
    const guardian = edge.parentType === "guardian";
    let colour: LineColour = "guardian";
    if (!guardian) {
      if (!colourOf.has(edge.from)) colourOf.set(edge.from, fresh());
      colour = colourOf.get(edge.from)!;
    }
    const x1 = from.x + NODE_WIDTH / 2;
    const bottom = from.y + NODE_HEIGHT;
    const y = laneY(`${edge.from}@${from.y}`, bottom, to.y, from.y);
    const kind = edge.parentType && edge.parentType !== "biological" ? edge.parentType : null;
    lines.push({
      key: `parent:${edge.from}:${edge.to}`,
      child: edge.to,
      colour,
      ended: edge.ended,
      label: edge.ended ? `former ${kind ?? "parent"}` : (kind ?? undefined),
      d: `M ${x1} ${bottom} V ${y} H ${to.x + NODE_WIDTH / 2} V ${to.y}`,
    });
  }

  return lines;
}
