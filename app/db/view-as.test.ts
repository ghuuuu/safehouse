/**
 * What view-as hands over, and to whom.
 *
 * The gate itself is tested in `app/view-as.server.test.ts`, without a
 * database, because it reads the actor from the session. These are the
 * assertions that need real Postgres: that the list query the vault page runs
 * is filtered by the policies rather than by itself, and that the roster
 * behaves the way the picker assumes.
 *
 * Both statements are imported rather than retyped. A test that reasons about
 * its own copy of a query proves something about the copy.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { ROSTER_SQL } from "../view-as.server";
import { forOwner, latestVersions, VAULT_LIST_SQL } from "../vault.server";
import { DOCUMENT, FILE, OWNER, USER } from "./fixture";
import { asUser, closeTestDatabase, prepareTestDatabase } from "./test-harness";

beforeAll(async () => {
  await prepareTestDatabase();
}, 60_000);

afterAll(async () => {
  await closeTestDatabase();
});

const documentNames = new Map(
  Object.entries(DOCUMENT).map(([name, id]) => [id, name]),
);

function named(ids: string[]) {
  return ids.map((id) => documentNames.get(id) ?? id).sort();
}

async function listedTo(userId: string) {
  const rows = await asUser(userId, (sql) => sql.unsafe(VAULT_LIST_SQL));
  return named(rows.map((row) => row.id as string));
}

/** The plainest possible question, with no join to widen it. */
async function documentsVisibleTo(userId: string) {
  const rows = await asUser(userId, (sql) => sql`select id from documents`);
  return named(rows.map((row) => row.id as string));
}

async function rosterFor(userId: string) {
  const rows = await asUser(userId, (sql) => sql.unsafe(ROSTER_SQL));
  return rows.map((row) => row.name as string);
}

const EVERYONE = Object.values(USER);

describe("the list the vault page runs", () => {
  test.each(Object.entries(USER))(
    "shows %s exactly the documents the policies allow",
    async (_name, userId) => {
      // The list joins documents to records and owners to get a title and an
      // owner name. All three tables carry row-level security, so the joins
      // cannot widen the answer — but a join written against a table that
      // later loses its policy could, and this is what would notice.
      expect(await listedTo(userId)).toEqual(await documentsVisibleTo(userId));
    },
  );

  test("a third party sees the granted business papers and the will", async () => {
    // Spelled out rather than compared to another query, so that a change
    // which broke both in the same direction still fails here.
    expect(await listedTo(USER.sam)).toEqual([
      "haleClientContract",
      "haleInsurancePolicy",
      "haleLeaseContract",
      "halePermit",
      "halePermitOld",
      "haleRegistration",
      "haleTaxReturn",
      "roseWill",
      "roseWillOld",
    ]);
  });

  test("a document reached by record grant keeps its place without an owner", async () => {
    // The bug this suite was written to find. A per-record grant (D17) carries
    // the record but not its owner: Sam can see Rose's will and cannot see
    // Rose. An inner join to `owners` for the display name silently dropped
    // the will off his list — a document he is entitled to see, gone, because
    // a second table declined to describe it.
    //
    // So the list keeps the row and leaves the name null, and the page says
    // "owner not shown to you" rather than rendering a blank.
    const rows = await asUser(USER.sam, (sql) => sql.unsafe(VAULT_LIST_SQL));
    const will = rows.find((row) => row.id === DOCUMENT.roseWill);

    expect(will).toBeDefined();
    expect(will?.ownerName).toBeNull();
    expect(will?.title).toBe("Last will");
  });

  test("the owner name is present whenever the owner is visible", async () => {
    // The other half: null must mean "not entitled", never "the join is
    // flaky". For the admin, who sees every owner, nothing may come back null.
    const rows = await asUser(USER.priya, (sql) => sql.unsafe(VAULT_LIST_SQL));

    expect(rows.every((row) => row.ownerName !== null)).toBe(true);
  });

  test("the owner id is withheld exactly when the owner name is", async () => {
    // The id is what a tree click filters on. Carrying it for a per-record
    // grant would hand Sam an identifier for an owner he may not see.
    for (const userId of [USER.sam, USER.priya, USER.maya]) {
      const rows = await asUser(userId, (sql) => sql.unsafe(VAULT_LIST_SQL));
      for (const row of rows) {
        expect(row.ownerId === null, `${row.title}`).toBe(row.ownerName === null);
      }
    }
  });

  test("a parent's list excludes a child's private letter", async () => {
    const listed = await listedTo(USER.maya);

    expect(listed).toContain("ivyImmunisation");
    expect(listed).not.toContain("ivyCounselling");
  });

  test("an account nobody attached to the tree gets an empty list", async () => {
    expect(await listedTo(USER.stranger)).toEqual([]);
  });

  test("it never carries a document identifier", async () => {
    // `documents.identifier` is the passport number. Masked in the interface
    // has to mean absent from the payload (CLAUDE.md) — a later `d.*` here
    // would put it back without anybody noticing in the diff.
    const rows = await asUser(USER.priya, (sql) => sql.unsafe(VAULT_LIST_SQL));
    const values = rows.flatMap((row) => Object.values(row)).map(String);

    expect(values.some((value) => value.includes("FIXTURE-PP"))).toBe(false);
  });

  test("a document links to its first page, and counts the pages it has", async () => {
    // The deed is the only two-page document in the fixture. A join instead of
    // these subqueries would list it twice; a viewer who cannot see a page
    // must not be told it is there.
    const rows = await asUser(USER.priya, (sql) => sql.unsafe(VAULT_LIST_SQL));
    const deed = rows.filter((row) => row.id === DOCUMENT.householdDeed);
    const decree = rows.find((row) => row.id === DOCUMENT.danielDivorceDecree);

    expect(deed).toHaveLength(1);
    expect(deed[0].fileCount).toBe(2);
    expect(deed[0].fileId).toBe(FILE.householdDeed);

    // Reachable, with nothing scanned behind it yet.
    expect(decree?.fileCount).toBe(0);
    expect(decree?.fileId).toBeNull();
  });

});

describe("narrowing the list to one owner", () => {
  async function listedToFor(userId: string, ownerId: string) {
    const rows = await asUser(userId, (sql) => sql.unsafe(VAULT_LIST_SQL));
    return named(forOwner(rows as unknown as { id: string; ownerId: string | null }[], ownerId).map((row) => row.id));
  }

  test("gives the owner's documents the viewer could already see, and nothing else", async () => {
    // Ivy's counselling letter is private: Maya does not get it by asking for
    // Ivy, because narrowing starts from what the policies already returned.
    expect(await listedToFor(USER.maya, OWNER.ivy)).toEqual([
      "ivyBirthCertificate",
      "ivyImmunisation",
      "ivyInsuranceCard",
    ]);
  });

  test.each([
    ["an owner outside the viewer's circle", OWNER.nadia],
    ["an owner reached only through a per-record grant", OWNER.rose],
    ["an owner that does not exist", "00000000-0000-4000-8000-000000000999"],
    ["something that is not an id", "'; drop table records; --"],
  ])("%s gives the same empty answer", async (_case, ownerId) => {
    // Indistinguishable from an owner with no documents, so the parameter
    // cannot be used to ask whether somebody exists.
    const viewer = ownerId === OWNER.rose ? USER.sam : USER.maya;
    expect(await listedToFor(viewer, ownerId)).toEqual([]);
  });

  test("composes with viewing as somebody: the same answer they would get", async () => {
    // View-as is the same query in the viewed user's transaction, so the
    // narrowing cannot behave differently there. Asserted anyway, because the
    // tree's click-through is exactly this combination.
    expect(await listedToFor(USER.daniel, OWNER.theo)).toEqual(["theoPassport"]);
    expect(await listedToFor(USER.maya, OWNER.theo)).toEqual([]);
  });
});

describe("one row per record, the older versions behind it", () => {
  type Row = { id: string; recordId: string; versionNo: number; isCurrent: boolean };
  async function stackedFor(userId: string) {
    const rows = (await asUser(userId, (sql) => sql.unsafe(VAULT_LIST_SQL))) as unknown as Row[];
    return { rows, stacked: latestVersions(rows) };
  }

  test("the current version stands for its record, counting what is behind it", async () => {
    const { rows, stacked } = await stackedFor(USER.priya);
    const passport = stacked.filter((row) => row.recordId === rows.find((r) => r.id === DOCUMENT.mayaPassport)?.recordId);

    expect(passport).toHaveLength(1);
    expect(passport[0].id).toBe(DOCUMENT.mayaPassport);
    expect(passport[0].olderVersions).toBe(1);
    // Nothing older is in the list on its own any more.
    expect(stacked.some((row) => row.id === DOCUMENT.mayaPassportOld)).toBe(false);
    expect(stacked.every((row) => row.isCurrent)).toBe(true);
    expect(stacked).toHaveLength(rows.filter((row) => row.isCurrent).length);
  });

  test("counts only versions the viewer was already given", async () => {
    // Narrowing, like forOwner: the count is of rows the policies returned, so
    // it cannot tell anyone about a version they may not see.
    const { rows, stacked } = await stackedFor(USER.maya);
    const older = stacked.reduce((n, row) => n + row.olderVersions, 0);

    expect(older + stacked.length).toBe(rows.length);
  });

  test("a record seen only by an older version still shows, as that version", () => {
    const stacked = latestVersions([
      { id: "a1", recordId: "a", versionNo: 1, isCurrent: false },
      { id: "a2", recordId: "a", versionNo: 2, isCurrent: false },
    ]);

    expect(stacked.map((row) => [row.id, row.olderVersions])).toEqual([["a2", 1]]);
  });

  test("the version marked current wins, whatever its number", () => {
    const stacked = latestVersions([
      { id: "b2", recordId: "b", versionNo: 2, isCurrent: false },
      { id: "b1", recordId: "b", versionNo: 1, isCurrent: true },
    ]);

    expect(stacked.map((row) => [row.id, row.olderVersions])).toEqual([["b1", 1]]);
  });
});

describe("the roster the picker offers", () => {
  test("an admin is offered the whole household", async () => {
    expect(await rosterFor(USER.priya)).toHaveLength(EVERYONE.length);
  });

  test.each([
    ["an individual", USER.maya, "Maya Adeyemi"],
    ["a third party", USER.sam, "Sam Okafor"],
    ["an emergency contact", USER.medic, "Emergency Contact"],
  ])("%s is offered only themselves", async (_who, userId, name) => {
    // The picker is not rendered for them, but the gate is what refuses the
    // parameter — this is the layer underneath it. Even if the dropdown were
    // rendered by mistake it would contain one name, and that name is theirs.
    expect(await rosterFor(userId)).toEqual([name]);
  });

  test("a disabled account still reads its own row, and never gets to use it", async () => {
    // `users_read` is `id = current_app_user() or current_user_is_admin()`,
    // and the first half names the raw table rather than `app_user` — so being
    // disabled does not hide you from yourself. That is harmless only because
    // the account never reaches this query: `getSignedInUser` treats a
    // disabled account as signed out from that moment, so the request becomes
    // a redirect before any roster is loaded.
    //
    // Written down because the harmlessness depends on that other module, and
    // a change there would make this row matter.
    expect(await rosterFor(USER.tenant)).toEqual(["Former Lodger"]);
  });

  test("read while impersonating, the roster collapses to the viewed user", async () => {
    // The ordering trap in `resolveViewContext`, pinned. `users_read` is
    // `id = current_app_user() or perm.current_user_is_admin()`, and inside an
    // impersonated transaction both halves answer for the viewed user. Loading
    // the picker there would leave an admin holding a dropdown of one — it
    // fails closed, and it fails confusingly, so the correct order is the one
    // this test describes.
    expect(await rosterFor(USER.maya)).toEqual(["Maya Adeyemi"]);
    expect(await rosterFor(USER.priya)).toHaveLength(EVERYONE.length);
  });
});
