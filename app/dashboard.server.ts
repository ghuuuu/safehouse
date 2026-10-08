/**
 * The dashboard's data (Step 14, PRODUCT.md §Screens).
 *
 * No permission logic. Everything is read through the caller's transaction, so
 * every count is the policies' answer: a document the viewer cannot open is not
 * counted, an owner they cannot see is not drawn. Nothing selects an
 * identifier.
 *
 * The mode switch splits by owner kind (PRODUCT.md §Owners). Businesses is
 * business owners. Individuals is people, the household, and any record whose
 * owner the viewer cannot see (a per-record grant, D17), which has to land
 * somewhere and cannot say whose it is.
 */

import { sql } from "drizzle-orm";

import type { Mode } from "./dashboard";
import type { VaultTransaction } from "./db.server";
import { CATEGORIES, type Category } from "./documents";
import { findExpiring, type ExpiringSoon } from "./expiry.server";
import type { FamilyTree } from "./tree";
import { getFamilyTree } from "./tree.server";

export { MODES, type Mode } from "./dashboard";

export type Dashboard = {
  tree: FamilyTree;
  expiring: ExpiringSoon;
  /** All six, in the product's order, current documents only. */
  categories: { category: Category; count: number }[];
  /** The subcategories this viewer has documents in, most used first. */
  chips: { label: string; count: number }[];
};

const CHIPS = 8;

export async function getDashboard(db: VaultTransaction, mode: Mode): Promise<Dashboard> {
  const businesses = mode === "businesses";
  // `o.kind` is null when the owner is hidden; `is distinct from` puts that row
  // under Individuals rather than nowhere.
  const inMode = businesses ? sql`o.kind = 'business'` : sql`o.kind is distinct from 'business'`;

  const counts = await db.execute<{ category: Category; count: number }>(sql`
    select r.category, count(*)::int as count
    from documents d
    join records r on r.id = d.record_id
    left join owners o on o.id = r.owner_id
    where d.is_current and ${inMode}
    group by r.category
  `);

  const chips = await db.execute<{ label: string; count: number }>(sql`
    select s.label, count(*)::int as count
    from documents d
    join records r on r.id = d.record_id
    join subcategories s on s.id = r.subcategory_id
    left join owners o on o.id = r.owner_id
    where d.is_current and ${inMode}
    group by s.label
    order by count desc, s.label
    limit ${CHIPS}
  `);

  const byCategory = new Map([...counts].map((row) => [row.category, row.count]));
  const expiring = await findExpiring(db);

  return {
    tree: await getFamilyTree(db),
    expiring: {
      ...expiring,
      soon: expiring.soon.filter((item) => (item.ownerKind === "business") === businesses),
    },
    categories: CATEGORIES.map((category) => ({ category, count: byCategory.get(category) ?? 0 })),
    chips: [...chips],
  };
}
