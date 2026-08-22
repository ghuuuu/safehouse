/**
 * What the database will and will not hand over.
 *
 * These tests are the review process. Nobody reads the diff that changes a
 * permission rule, so the rule has to be checked by something that runs.
 *
 * Every assertion goes through the restricted role and the real policies, and
 * asks the plainest question the application will ever ask — `select id from
 * records` — with no permission logic of its own. If row-level security is not
 * doing the work, these tests notice.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { DOCUMENT, FILE, OWNER, RECORD, USER } from "./fixture";
import {
  asNobody,
  asUser,
  closeTestDatabase,
  prepareTestDatabase,
} from "./test-harness";

beforeAll(async () => {
  await prepareTestDatabase();
}, 60_000);

afterAll(async () => {
  await closeTestDatabase();
});

/** Turns fixture ids back into their names, so a failure reads like English. */
function namer(table: Record<string, string>) {
  const byId = new Map(Object.entries(table).map(([name, id]) => [id, name]));
  return (ids: string[]) =>
    ids.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
}

const ownerNames = namer(OWNER);
const recordNames = namer(RECORD);
const documentNames = namer(DOCUMENT);
const fileNames = namer(FILE);

async function ownersVisibleTo(userId: string | null) {
  const rows = await asUser(userId, (sql) => sql`select id from owners`);
  return ownerNames(rows.map((row) => row.id as string));
}

async function recordsVisibleTo(userId: string | null) {
  const rows = await asUser(userId, (sql) => sql`select id from records`);
  return recordNames(rows.map((row) => row.id as string));
}

async function documentsVisibleTo(userId: string | null) {
  const rows = await asUser(userId, (sql) => sql`select id from documents`);
  return documentNames(rows.map((row) => row.id as string));
}

async function filesVisibleTo(userId: string | null) {
  const rows = await asUser(userId, (sql) => sql`select id from document_files`);
  return fileNames(rows.map((row) => row.id as string));
}

async function circleOf(userId: string) {
  const rows = await asUser(
    userId,
    (sql) => sql`select owner_id from family_circle where user_id = ${userId}`,
  );
  return ownerNames(rows.map((row) => row.owner_id as string));
}

describe("the family circle (D16)", () => {
  test("reaches self, spouse, children, parents and the spouse's parents", async () => {
    expect(await circleOf(USER.daniel)).toEqual([
      "daniel",
      "frank",
      "ivy",
      "maya",
      "rose",
      "theo",
    ]);
  });

  test("does not reach a grandparent", async () => {
    // Ivy's grandparents are Rose and Frank. Two steps is one step too many:
    // the circle is deliberately shallow.
    expect(await circleOf(USER.ivy)).toEqual(["daniel", "ivy", "maya"]);
  });

  test("a step-child is not in it", async () => {
    // Maya is married to Theo's father and has a recorded step edge to Theo.
    // That edge confers nothing on its own (D16) — reaching Theo takes a grant.
    expect(await circleOf(USER.maya)).toEqual([
      "daniel",
      "frank",
      "ivy",
      "maya",
      "rose",
    ]);
  });

  test("an ended marriage takes the ex-spouse and their parents out", async () => {
    const circle = await circleOf(USER.daniel);

    expect(circle).not.toContain("nadia");
    expect(circle).not.toContain("omar");
  });

  test("a shared child survives the divorce", async () => {
    expect(await circleOf(USER.daniel)).toContain("theo");
  });

  test("a live guardianship acts as a parent edge, an ended one does not", async () => {
    const circle = await circleOf(USER.rose);

    expect(circle).toContain("lena");
    expect(circle).not.toContain("bram");
  });

  test("a deceased spouse stays in it", async () => {
    // This is the moment the will matters most (D16).
    expect(await circleOf(USER.rose)).toContain("frank");
  });
});

describe("which owners a user can see", () => {
  test("an individual sees their circle, the household, and owners granted to them", async () => {
    expect(await ownersVisibleTo(USER.daniel)).toEqual([
      "daniel",
      "frank",
      "hale",
      "household",
      "ivy",
      "maya",
      "rose",
      "theo",
    ]);
  });

  test("an individual does not see a business nobody granted them", async () => {
    expect(await ownersVisibleTo(USER.maya)).not.toContain("hale");
  });

  test("the admin sees every owner", async () => {
    expect(await ownersVisibleTo(USER.priya)).toHaveLength(
      Object.keys(OWNER).length,
    );
  });

  test("a third party sees only what was granted", async () => {
    expect(await ownersVisibleTo(USER.sam)).toEqual(["hale"]);
  });

  test("a disabled account sees nothing, grants and all", async () => {
    expect(await ownersVisibleTo(USER.tenant)).toEqual([]);
  });
});

describe("which records a user can see", () => {
  test("a parent sees a child's immunisation record but not their private letter", async () => {
    const records = await recordsVisibleTo(USER.maya);

    expect(records).toContain("ivyImmunisation");
    expect(records).not.toContain("ivyCounselling");
  });

  test("the owner of a private record sees it", async () => {
    expect(await recordsVisibleTo(USER.ivy)).toContain("ivyCounselling");
  });

  test("the admin sees private records too", async () => {
    // Privacy here is from family, not from the person who runs the server.
    // The interface has to say so rather than imply otherwise (D17).
    const records = await recordsVisibleTo(USER.priya);

    expect(records).toContain("ivyCounselling");
    expect(records).toContain("roseWill");
  });

  test("an individual sees the household's shared papers", async () => {
    expect(await recordsVisibleTo(USER.maya)).toContain("householdDeed");
  });

  test("an ex-spouse's papers are gone", async () => {
    expect(await recordsVisibleTo(USER.daniel)).not.toContain("nadiaPassport");
  });

  test("a third party needs both the owner and the category", async () => {
    const records = await recordsVisibleTo(USER.sam);

    // Granted Hale Consulting, plus the business and financial categories.
    expect(records).toContain("halePermit");
    expect(records).toContain("haleTaxReturn");
    // Same categories, different owner.
    expect(records).not.toContain("mayaPassport");
    // Same owner would not help either: the household deed is legal.
    expect(records).not.toContain("householdDeed");
  });

  test("a per-record grant is the only way into a private record", async () => {
    // Sam was granted Rose's will by name. It is private, and legal is not in
    // his category list — the grant overrides both, and nothing else does.
    expect(await recordsVisibleTo(USER.sam)).toEqual([
      "halePermit",
      "haleTaxReturn",
      "roseWill",
    ]);
  });
});

describe("breaking the glass (D19)", () => {
  test("a live window reaches the critical categories, including private ones", async () => {
    const records = await recordsVisibleTo(USER.medic);

    expect(records).toContain("ivyImmunisation");
    expect(records).toContain("lenaCarePlan");
    expect(records).toContain("householdDeed");
    // A private advance directive hidden during an emergency defeats the
    // feature. Private is reachable here on purpose (D17).
    expect(records).toContain("ivyCounselling");
    expect(records).toContain("roseWill");
  });

  test("a live window reaches nothing else", async () => {
    const records = await recordsVisibleTo(USER.medic);

    expect(records).not.toContain("mayaPassport");
    expect(records).not.toContain("haleTaxReturn");
  });

  test("an expired window is closed by the database clock, not by a job", async () => {
    expect(await recordsVisibleTo(USER.lapsed)).toEqual([]);
  });

  test("a revoked window closes immediately", async () => {
    expect(await recordsVisibleTo(USER.pulled)).toEqual([]);
  });
});

describe("documents and files follow their record (D20)", () => {
  test("a document under a private record is invisible to the family", async () => {
    expect(await documentsVisibleTo(USER.maya)).not.toContain("ivyCounselling");
    expect(await filesVisibleTo(USER.maya)).not.toContain("ivyCounselling");
  });

  test("its owner sees both the document and the file", async () => {
    expect(await documentsVisibleTo(USER.ivy)).toContain("ivyCounselling");
    expect(await filesVisibleTo(USER.ivy)).toContain("ivyCounselling");
  });

  test("a per-record grant carries the file with it", async () => {
    expect(await filesVisibleTo(USER.sam)).toEqual(["roseWill"]);
  });

  test("a superseded version stays visible to whoever can see the record", async () => {
    const documents = await documentsVisibleTo(USER.daniel);

    expect(documents).toContain("danielLicenceOld");
    expect(documents).toContain("danielLicence");
  });
});

describe("the guardrails", () => {
  test("a request that forgets to say who is asking gets nothing", async () => {
    // This is what a bug looks like: the session variable never set. Every
    // policy compares against a null user, nothing matches, and the household
    // sees an empty page instead of somebody else's passport.
    expect(await ownersVisibleTo(null)).toEqual([]);
    expect(await recordsVisibleTo(null)).toEqual([]);
    expect(await documentsVisibleTo(null)).toEqual([]);
    expect(await filesVisibleTo(null)).toEqual([]);
  });

  test("a request that never sets a user cannot inherit the last one", async () => {
    // The connection is pooled, and the admin has just used it. The setting is
    // scoped to a transaction, so it does not survive into the next one — and a
    // request that skips the helper entirely gets nothing rather than whatever
    // the previous request was allowed to see.
    await asUser(USER.priya, (sql) => sql`select id from records`);

    const rows = await asNobody((sql) => sql`select id from records`);

    expect(rows).toEqual([]);
  });

  test("a query written without any permission join is still filtered", async () => {
    // The point of D11. This query has no idea permissions exist.
    const [row] = await asUser(
      USER.sam,
      (sql) => sql`select count(*)::int as n from records`,
    );

    expect(row.n).toBe(3);
  });

  test("the role the application connects as cannot bypass a policy", async () => {
    const [role] = await asUser(
      USER.priya,
      (sql) => sql`
        select rolsuper, rolbypassrls
        from pg_roles
        where rolname = current_user
      `,
    );

    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  test("every table holding household data has row-level security on", async () => {
    // Adding a table without a policy is the easiest way to leak, and the one
    // least likely to be noticed. A new table fails here until it is either
    // given policies or listed here with a reason written next to it. Nothing
    // is on the list today.
    const openOnPurpose = new Set<string>([]);

    const rows = await asUser(
      USER.priya,
      (sql) => sql`
        select c.relname, c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname
      `,
    );

    const unprotected = rows
      .filter((row) => !row.relrowsecurity && !openOnPurpose.has(row.relname))
      .map((row) => row.relname as string);

    expect(unprotected).toEqual([]);
  });
});
