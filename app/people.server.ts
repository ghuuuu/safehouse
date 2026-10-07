/**
 * The household roster, and adding somebody to it.
 *
 * One sentence drives the whole thing: *"___ is the ___ of ___."* Name the
 * person, pick the relationship, pick who they attach to (`PRODUCT.md`
 * §Screens). The first person in a household has nobody to attach to, so the
 * link is allowed to be absent rather than faked.
 *
 * **A person is not a login.** Creating one of these rows grants nobody
 * anything; it says somebody exists and how they are related. Attaching an
 * account happens elsewhere, on the other connection (D24), and that is the act
 * with the escalation risk in it.
 *
 * What is not here is any permission logic. The roster reads `owners`, `people`
 * and `users` through the ordinary policies, so a viewer sees the owners they
 * are entitled to and — because `users_read` hands out your own row and the
 * admin's view — somebody else's login shows as absent without a line of
 * filtering (CLAUDE.md). Adding a person is refused by
 * `0009_person_writes.sql`, not by a role check written here.
 *
 * Nothing in this module logs. A person's name and date of birth are record
 * field values by any reasonable reading of CLAUDE.md.
 */

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { VaultTransaction } from "./db.server";
import type { Link, ParentType, Sex } from "./people";

export type NewPerson = {
  givenName: string;
  familyName: string;
  bornOn: string | null;
  /** Absent or null when the form left it blank. */
  sex?: Sex | null;
  /** Null for the first person in a household, who has nobody to attach to. */
  link: Link | null;
};

export type Added =
  | { ok: true; ownerId: string }
  /** Something the person filling in the form can fix, said in their words. */
  | { ok: false; problem: string };

export type RosterEntry = {
  ownerId: string;
  kind: "person" | "business" | "household";
  displayName: string;
  /**
   * Said because the roster says it. Given name, family name and date of birth
   * are deliberately absent: nothing renders them, and a payload that carries
   * what the page does not draw is the habit that puts a passport number in a
   * response one refactor later (CLAUDE.md).
   */
  diedOn: string | null;
  archived: boolean;
  recordCount: number;
  /** Null when there is no login, or when this viewer may not see it. */
  account: { name: string; role: string; disabled: boolean } | null;
};

export async function listHousehold(
  db: VaultTransaction,
): Promise<RosterEntry[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select
      o.id as "ownerId",
      o.kind,
      o.display_name as "displayName",
      o.archived_at is not null as archived,
      to_char(p.died_on, 'YYYY-MM-DD') as "diedOn",
      (select count(*) from records r where r.owner_id = o.id)::int
        as "recordCount",
      -- Read through users_read, which gives out your own row and the whole
      -- table to an admin. So a member looking at their family sees one login,
      -- their own, and the rest come back null — the filtering is the policy's,
      -- not this query's. At most one account can be here: a partial unique
      -- index in 0009 makes a second one impossible, which is what lets this be
      -- a join rather than a correlated lookup.
      u.name as "accountName",
      u.role as "accountRole",
      u.disabled_at is not null as "accountDisabled"
    from owners o
    left join people p on p.owner_id = o.id
    left join users u on u.person_owner_id = o.id
    order by o.kind, o.display_name
  `);

  return [...rows].map((row) => ({
    ownerId: row.ownerId as string,
    kind: row.kind as RosterEntry["kind"],
    displayName: row.displayName as string,
    diedOn: (row.diedOn as string | null) ?? null,
    archived: row.archived as boolean,
    recordCount: row.recordCount as number,
    account: row.accountName
      ? {
          name: row.accountName as string,
          role: row.accountRole as string,
          disabled: row.accountDisabled as boolean,
        }
      : null,
  }));
}

/**
 * Owners the new person could attach to: the people already in the tree.
 *
 * Only what the asker can see, for the same reason as everything else. In
 * practice only an admin reaches the form at all, and an admin sees everybody.
 */
export async function listAnchors(
  db: VaultTransaction,
): Promise<{ ownerId: string; displayName: string; hasParent: boolean }[]> {
  const rows = await db.execute<{
    ownerId: string;
    displayName: string;
    hasParent: boolean;
  }>(sql`
    select
      o.id as "ownerId",
      o.display_name as "displayName",
      exists (
        select 1 from relationships r
        where r.to_owner_id = o.id
          and r.kind = 'parent_of'
          and r.ended_on is null
      ) as "hasParent"
    from owners o
    join people p on p.owner_id = o.id
    where o.archived_at is null
    order by o.display_name
  `);

  return [...rows];
}

/**
 * Write a person, and the one edge that says where they belong.
 *
 * Three statements in the caller's transaction, which is the whole transaction
 * for the request: if the relationship is refused, the owner and the person go
 * with it. A half-added person — in the roster, attached to nobody, with no way
 * to tell whether that was meant — is worse than a failed form.
 */
export async function addPerson(
  db: VaultTransaction,
  person: NewPerson,
): Promise<Added> {
  const givenName = person.givenName.trim();
  const familyName = person.familyName.trim();

  if (!givenName || !familyName) {
    return { ok: false, problem: "A given name and a family name, please." };
  }

  // Resolved before anything is written, because the answer can be "no" and a
  // refusal is cheaper than a rollback.
  const parents =
    person.link?.relation === "sibling_of"
      ? await activeParentsOf(db, person.link.anchorOwnerId)
      : [];

  if (person.link?.relation === "sibling_of" && parents.length === 0) {
    return {
      ok: false,
      problem:
        "Siblings are worked out from a shared parent rather than stored, so this needs a parent on file first. Add the parent, then come back.",
    };
  }

  // The id is made here rather than asked for back, and not only to match
  // `fileDocument`. `returning id` is read through `owners_read`, whose
  // predicate is a STABLE function over the permission views — and a stable
  // function is evaluated against the snapshot the statement began with, which
  // does not contain the row being inserted. The insert succeeds, the read of
  // its own output does not, and Postgres reports it as a row-level security
  // violation on the insert. Measured, not guessed: that is what sent the first
  // run of people.test.ts red.
  const ownerId = randomUUID();

  await db.execute(sql`
    insert into owners (id, kind, display_name)
    values (${ownerId}, 'person', ${`${givenName} ${familyName}`})
  `);

  await db.execute(sql`
    insert into people (owner_id, given_name, family_name, born_on, sex)
    values (
      ${ownerId}, ${givenName}, ${familyName},
      ${person.bornOn ? sql`${person.bornOn}::date` : sql`null`},
      ${person.sex ? sql`${person.sex}::person_sex` : sql`null`}
    )
  `);

  for (const edge of edgesFor(ownerId, person.link, parents)) {
    await db.execute(sql`
      insert into relationships
        (from_owner_id, to_owner_id, kind, parent_type, started_on)
      values (
        ${edge.from}, ${edge.to}, ${edge.kind}, ${edge.parentType},
        ${person.bornOn && edge.kind === "parent_of" ? sql`${person.bornOn}::date` : sql`null`}
      )
    `);
  }

  return { ok: true, ownerId };
}

type Edge = {
  from: string;
  to: string;
  kind: "parent_of" | "spouse_of";
  parentType: ParentType | null;
};

/**
 * The sentence, turned into rows.
 *
 * `parent_of` runs from the parent to the child, so which end the new person
 * goes on is the entire difference between a mother and her daughter — and
 * `family_circle` reads it without asking twice. The test pins the direction
 * rather than trusting this comment.
 *
 * A sibling produces no edge of its own. D16 derives siblings from a shared
 * parent and never stores one, so the only honest way to make two people
 * siblings is to give them the same parents.
 */
function edgesFor(
  ownerId: string,
  link: Link | null,
  anchorParents: { ownerId: string; parentType: ParentType }[],
): Edge[] {
  if (!link) return [];

  switch (link.relation) {
    case "child_of":
      return [
        {
          from: link.anchorOwnerId,
          to: ownerId,
          kind: "parent_of",
          parentType: link.parentType,
        },
      ];
    case "parent_of":
      return [
        {
          from: ownerId,
          to: link.anchorOwnerId,
          kind: "parent_of",
          parentType: link.parentType,
        },
      ];
    case "spouse_of":
      // Stored once, in one direction, and the views read it both ways (D16).
      return [
        {
          from: ownerId,
          to: link.anchorOwnerId,
          kind: "spouse_of",
          parentType: null,
        },
      ];
    case "sibling_of":
      return anchorParents.map((parent) => ({
        from: parent.ownerId,
        to: ownerId,
        kind: "parent_of" as const,
        // The anchor's own kind of parenthood is copied: a step-parent of one
        // sibling is a step-parent of the other, and guessing "biological"
        // would quietly assert a thing nobody said.
        parentType: parent.parentType,
      }));
  }
}

/**
 * Who parents the anchor today. Ended edges are excluded on purpose: the
 * fixture's guardianship that ran out is exactly the case where copying an old
 * arrangement onto a new person would be wrong.
 */
async function activeParentsOf(
  db: VaultTransaction,
  anchorOwnerId: string,
): Promise<{ ownerId: string; parentType: ParentType }[]> {
  const rows = await db.execute<{ ownerId: string; parentType: ParentType }>(sql`
    select from_owner_id as "ownerId", parent_type as "parentType"
    from relationships
    where to_owner_id = ${anchorOwnerId}
      and kind = 'parent_of'
      and ended_on is null
    order by from_owner_id
  `);

  return [...rows];
}
