/**
 * What the family tree is given, and to whom.
 *
 * The tree has no permission logic of its own. It reads `owners`, `people` and
 * `relationships` through their policies, so these tests are about what those
 * policies hand to a picture. A relationship is drawn only when both of its
 * ends are visible; an edge with one end hidden would say "Daniel was married
 * to somebody you cannot see", which is itself something you cannot see.
 */

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { getFamilyTree, type FamilyTree } from "../tree.server";
import { OWNER, USER } from "./fixture";
import { closeTestDatabase, prepareTestDatabase } from "./test-harness";

let asUser: typeof import("../db.server").asUser;

beforeAll(async () => {
  await prepareTestDatabase();

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
}, 60_000);

afterAll(closeTestDatabase);

const OWNER_NAMES = new Map(Object.entries(OWNER).map(([name, id]) => [id, name]));
const name = (id: string) => OWNER_NAMES.get(id) ?? id;

function treeFor(userId: string): Promise<FamilyTree> {
  return asUser(userId, (db) => getFamilyTree(db));
}

function people(tree: FamilyTree) {
  return tree.people.map((person) => name(person.ownerId)).sort();
}

function edges(tree: FamilyTree) {
  return tree.edges
    .map((edge) => `${name(edge.from)} ${edge.kind} ${name(edge.to)}${edge.ended ? " (ended)" : ""}`)
    .sort();
}

describe("the admin", () => {
  test("sees every person, and every relationship including the ended ones", async () => {
    const tree = await treeFor(USER.priya);

    expect(people(tree)).toEqual([
      "bram", "daniel", "frank", "ivy", "lena", "maya", "nadia", "omar", "priya", "rose", "theo",
    ]);
    // Ended relationships are drawn, greyed (D33). They are history, and the
    // access model ignores them; the tree says which is which.
    expect(edges(tree)).toContain("daniel spouse_of nadia (ended)");
    expect(edges(tree)).toContain("rose parent_of bram (ended)");
    expect(edges(tree)).toContain("rose spouse_of frank");
    expect(tree.edges).toHaveLength(13);
  });

  test("gets businesses and the household apart from the people", async () => {
    const tree = await treeFor(USER.priya);

    expect(tree.businesses.map((owner) => name(owner.ownerId))).toEqual(["hale"]);
    expect(tree.households.map((owner) => name(owner.ownerId))).toEqual(["household"]);
  });

  test("is told who has died, and sex where it was recorded", async () => {
    const tree = await treeFor(USER.priya);
    const of = (id: string) => tree.people.find((person) => person.ownerId === id);

    expect(of(OWNER.frank)).toMatchObject({ deceased: true, sex: "male" });
    expect(of(OWNER.rose)).toMatchObject({ deceased: false, sex: "female" });
    expect(of(OWNER.bram)?.sex).toBeNull();
  });
});

describe("a member of the family", () => {
  test("sees their circle, and no relationship that leaves it", async () => {
    const tree = await treeFor(USER.maya);

    // Theo is Maya's step-son, and a step edge does not put him in her circle
    // (D16). Nadia is Daniel's former wife. Omar is Nadia's father.
    expect(people(tree)).toEqual(["daniel", "frank", "ivy", "maya", "rose"]);
    expect(edges(tree)).toEqual([
      "daniel parent_of ivy",
      "daniel spouse_of maya",
      "maya parent_of ivy",
      "rose parent_of maya",
      "frank parent_of maya",
      "rose spouse_of frank",
    ].sort());
  });

  test("gets the household, and no business they were not granted", async () => {
    const tree = await treeFor(USER.maya);

    expect(tree.households).toHaveLength(1);
    expect(tree.businesses).toEqual([]);
  });
});

describe("somebody outside the family", () => {
  test.each([
    ["a third party", USER.sam],
    ["an account attached to nobody", USER.stranger],
  ])("%s is shown nobody", async (_who, userId) => {
    const tree = await treeFor(userId);

    expect(tree.people).toEqual([]);
    expect(tree.edges).toEqual([]);
  });
});

test("the tree carries nothing it does not draw", async () => {
  // Given name, family name and date of birth are personal data the picture
  // does not use, so they are not in the payload (CLAUDE.md, and the same rule
  // `RosterEntry` follows).
  const tree = await treeFor(USER.priya);

  for (const person of tree.people) {
    // The paper count is drawn beside the name; see "the number beside a name".
    expect(Object.keys(person).sort()).toEqual(["deceased", "name", "ownerId", "papers", "sex"]);
  }
  expect(JSON.stringify(tree)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

describe("the number beside a name", () => {
  // A count is a listing: it must say exactly what the vault would list for
  // that person, to that viewer, and nothing the vault would not.
  test.each(Object.entries(USER))("is what the vault lists for them, as %s", async (_who, userId) => {
    const { forOwner, latestVersions, VAULT_LIST_SQL } = await import("../vault.server");
    const { tree, rows } = await asUser(userId, async (db) => ({
      tree: await getFamilyTree(db),
      rows: [...(await db.execute(sql.raw(VAULT_LIST_SQL)))] as unknown as {
        recordId: string;
        ownerId: string | null;
        versionNo: number;
        isCurrent: boolean;
      }[],
    }));
    const listed = latestVersions(rows);

    for (const owner of [...tree.people, ...tree.businesses, ...tree.households]) {
      expect([owner.ownerId, owner.papers]).toEqual([owner.ownerId, forOwner(listed, owner.ownerId).length]);
    }
  });

  test("counts records, not versions: a renewed passport is one paper", async () => {
    // Maya's passport has an older version behind the current one (fixture).
    const versions = await asUser(USER.priya, async (db) =>
      [...(await db.execute<{ n: number }>(sql`
        select count(*)::int as n from documents d join records r on r.id = d.record_id
        where r.owner_id = ${OWNER.maya}
      `))][0].n,
    );
    const tree = await treeFor(USER.priya);
    expect(tree.people.find((p) => p.ownerId === OWNER.maya)?.papers).toBe(versions - 1);
  });
});
