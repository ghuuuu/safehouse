/**
 * Search (Step 13, D35).
 *
 * Search is a new surface that lists documents, so CLAUDE.md asks how it
 * enforces access: it reads `documents`, `records` and `owners` through their
 * policies, in the searcher's own transaction (or the viewed user's, for an
 * admin using view-as). Nothing here filters. These tests check that the
 * policies' answer is the only answer, including for a number — a search must
 * not become a way to ask "does a document with this number exist?" about
 * documents the searcher cannot see.
 *
 * The number is matched by keyed fingerprint, never read. A last-four match
 * tells the searcher four characters of a masked value, so every match on a
 * number is written to the log before the results are returned.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql as drizzleSql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { SignedInUser } from "../session.server";
import { DOCUMENT, FIXTURE_KEY, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

let search: typeof import("../search.server");
let asUser: typeof import("../db.server").asUser;

beforeAll(async () => {
  await prepareTestDatabase();

  const dir = await mkdtemp(join(tmpdir(), "safehouse-search-"));
  await writeFile(join(dir, "key"), FIXTURE_KEY.toString("hex"));
  process.env.SAFEHOUSE_KEY_FILE = join(dir, "key");

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
  search = await import("../search.server");
}, 60_000);

afterAll(async () => {
  await owner()`delete from activity_events where action = 'field.matched'`;
  await closeTestDatabase();
});

const NAMES = new Map(Object.entries(DOCUMENT).map(([name, id]) => [id, name]));

function as(id: string, role = "individual"): SignedInUser {
  return { id, role, email: "x@example.invalid", name: "Fixture User", personOwnerId: null };
}

/** The searcher in their own eyes. */
const own = (id: string, role?: string) => ({ actor: as(id, role), viewedUserId: id, isViewingAs: false });

async function found(view: Parameters<typeof search.runSearch>[0], query: string) {
  const hits = await search.runSearch(view, query);
  return hits.map((hit) => `${NAMES.get(hit.documentId)}${hit.matchedNumber ? " #" : ""}`).sort();
}

async function matchLog() {
  return owner()`
    select actor_user_id, acting_as_user_id, subject_id from activity_events
    where action = 'field.matched' order by at
  `;
}

describe("words", () => {
  test("find titles, among what the searcher can see", async () => {
    // Maya reaches her own, Rose's and Daniel's passports through the tree.
    // Theo's and Nadia's exist, and are not hers to find. Her superseded
    // passport is a version of the same record, so words find the current one.
    expect(await found(own(USER.maya), "passport")).toEqual([
      "danielPassport", "mayaPassport", "rosePassport",
    ]);
  });

  test("every word has to match something: a name and a kind together", async () => {
    expect(await found(own(USER.maya), "rose PASSPORT")).toEqual(["rosePassport"]);
  });

  test("an owner nobody showed the searcher is not something to search by", async () => {
    // Sam reaches Rose's will through a per-record grant, without her name.
    expect(await found(own(USER.sam, "third_party"), "will")).toEqual(["roseWill"]);
    expect(await found(own(USER.sam, "third_party"), "rose")).toEqual([]);
  });

  test("a wildcard is a character, not a wildcard", async () => {
    expect(await found(own(USER.maya), "%")).toEqual([]);
    expect(await found(own(USER.maya), "_")).toEqual([]);
  });

  test("an empty search finds nothing rather than everything", async () => {
    expect(await found(own(USER.priya, "admin"), "   ")).toEqual([]);
  });
});

describe("a number", () => {
  test("the whole number, however it is typed", async () => {
    expect(await found(own(USER.maya), "FIXTURE-PP-0001")).toEqual(["mayaPassport #"]);
    expect(await found(own(USER.maya), "fixture pp 0001")).toEqual(["mayaPassport #"]);
  });

  test("the last four, among what the searcher can see", async () => {
    // Every fixture number ending 0001 that Maya reaches, and none she does not.
    const hits = await found(own(USER.maya), "0001");
    expect(hits).toContain("mayaPassport #");
    expect(hits).toContain("danielLicenceOld #");
    expect(hits).not.toContain("halePermitOld #");
    expect(hits.every((hit) => hit.endsWith("#"))).toBe(true);
  });

  test("a document the searcher cannot see does not answer, even to its exact number", async () => {
    expect(await found(own(USER.maya), "FIXTURE-PP-0003")).toEqual([]);
    expect(await found(own(USER.sam, "third_party"), "FIXTURE-PP-0001")).toEqual([]);
    expect(await found(own(USER.stranger), "0001")).toEqual([]);
  });

  test("an old version is found by its own number", async () => {
    expect(await found(own(USER.maya), "FIXTURE-PP-0001-A")).toEqual(["mayaPassportOld #"]);
  });

  test("a fragment from the middle finds nothing: that is the trade D35 made", async () => {
    expect(await found(own(USER.maya), "PP-00")).toEqual([]);
  });

  test("the results never carry the number, sealed or otherwise", async () => {
    const hits = await search.runSearch(own(USER.maya), "FIXTURE-PP-0001");
    const payload = JSON.stringify(hits);

    expect(payload).not.toContain("FIXTURE");
    expect(Object.keys(hits[0]).sort()).toEqual(
      ["category", "documentId", "isCurrent", "matchedNumber", "ownerName", "title"].sort(),
    );
  });
});

describe("the log", () => {
  test("a match on a number is written down, once per document, before results return", async () => {
    await owner()`delete from activity_events where action = 'field.matched'`;
    await search.runSearch(own(USER.maya), "FIXTURE-PP-0001");

    const lines = await matchLog();
    expect(lines.map((line) => [line.actor_user_id, line.subject_id])).toEqual([
      [USER.maya, DOCUMENT.mayaPassport],
    ]);
  });

  test("a search that matched only words writes nothing", async () => {
    await owner()`delete from activity_events where action = 'field.matched'`;
    await search.runSearch(own(USER.maya), "passport");
    expect(await matchLog()).toEqual([]);
  });

  test("through borrowed eyes: the admin's own reach-limited answer, logged as the admin", async () => {
    await owner()`delete from activity_events where action = 'field.matched'`;
    const asMaya = { actor: as(USER.priya, "admin"), viewedUserId: USER.maya, isViewingAs: true };

    expect(await found(asMaya, "FIXTURE-PP-0003")).toEqual([]);
    expect(await found(asMaya, "FIXTURE-PP-0001")).toEqual(["mayaPassport #"]);

    const [line] = await matchLog();
    expect([line.actor_user_id, line.acting_as_user_id]).toEqual([USER.priya, USER.maya]);
  });

  test("searching through borrowed eyes is read-only, like the rest of view-as", async () => {
    const error = await asUser(USER.maya, async (db) => {
      await db.execute(drizzleSql`set transaction read only`);
      return db.execute(drizzleSql`update documents set place_of_issue = 'x' where id = ${DOCUMENT.mayaPassport}`);
    }).catch((e: { cause?: { code?: string } }) => e.cause?.code);
    expect(error).toBe("25006");
  });
});
