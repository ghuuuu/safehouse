/**
 * What the family tree is drawn from.
 *
 * No permission logic. Every query reads through the caller's transaction, so
 * `owners_read`, `people_read` and `relationships_read` decide what comes back.
 * Under view-as, that is the viewed user's answer. A relationship is readable
 * only when both of its ends are, so the tree never draws a line to somebody
 * the viewer cannot see.
 *
 * Only what is drawn is selected: a name, whether the person has died, sex
 * where it was recorded, and how many papers they have. Not given name, family
 * name or date of birth.
 *
 * The paper count is a listing, so it reads exactly what the vault lists:
 * records with at least one version the viewer may see (`latestVersions` in
 * `app/vault.server.ts` folds the same rows). It runs through the same
 * policies, and `tree.test.ts` holds it to the vault's own answer.
 */

import { sql } from "drizzle-orm";

import type { VaultTransaction } from "./db.server";
import type { FamilyTree, TreeEdge, TreePerson } from "./tree";

export type { FamilyTree } from "./tree";

export async function getFamilyTree(db: VaultTransaction): Promise<FamilyTree> {
  const owners = await db.execute<{
    ownerId: string;
    kind: "person" | "business" | "household";
    name: string;
    deceased: boolean | null;
    sex: TreePerson["sex"];
    papers: number;
  }>(sql`
    select
      o.id as "ownerId",
      o.kind,
      o.display_name as name,
      p.died_on is not null as deceased,
      p.sex,
      (
        select count(distinct d.record_id)::int
        from documents d join records r on r.id = d.record_id
        where r.owner_id = o.id
      ) as papers
    from owners o
    left join people p on p.owner_id = o.id
    where o.archived_at is null
    order by o.display_name
  `);

  // Ended relationships come too: the tree draws them greyed (D33). Ordered so
  // the same household always lays out the same way.
  const edges = await db.execute<TreeEdge>(sql`
    select
      r.from_owner_id as "from",
      r.to_owner_id as "to",
      r.kind,
      r.parent_type as "parentType",
      r.ended_on is not null as ended
    from relationships r
    order by r.kind, r.from_owner_id, r.to_owner_id
  `);

  const rows = [...owners];
  const people = rows
    .filter((row) => row.kind === "person")
    .map(({ ownerId, name, deceased, sex, papers }) => ({
      ownerId,
      name,
      deceased: deceased === true,
      sex: sex ?? null,
      papers,
    }));
  const visible = new Set(people.map((person) => person.ownerId));

  return {
    people,
    // Already guaranteed by `relationships_read`. Checked again so an archived
    // person, who is visible but not drawn, does not leave a line to nothing.
    edges: [...edges].filter((edge) => visible.has(edge.from) && visible.has(edge.to)),
    businesses: rows
      .filter((row) => row.kind === "business")
      .map(({ ownerId, name, papers }) => ({ ownerId, name, papers })),
    households: rows
      .filter((row) => row.kind === "household")
      .map(({ ownerId, name, papers }) => ({ ownerId, name, papers })),
  };
}
