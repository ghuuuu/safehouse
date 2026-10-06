/**
 * The Record screen's data, and the one value it must never hand over by
 * accident.
 *
 * The masking assertion is the point of this file. CLAUDE.md: masked in the
 * interface means absent from the payload. A test that checked the screen hid
 * the number would pass against a payload that carried it.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  findRecordView,
  revealIdentifier,
  saveFields,
} from "../record.server";
import { DOCUMENT, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

let asUser: typeof import("../db.server").asUser;

beforeAll(async () => {
  await prepareTestDatabase();

  const dir = await mkdtemp(join(tmpdir(), "safehouse-record-"));
  await writeFile(join(dir, "key"), randomBytes(32).toString("hex"));
  process.env.SAFEHOUSE_KEY_FILE = join(dir, "key");
  process.env.SAFEHOUSE_STORAGE_DIR = dir;

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
}, 60_000);

afterAll(async () => {
  // Put back what these tests changed, so the fixture stays the fixture.
  await owner()`
    update documents
    set expires_on = '2029-01-31', place_of_issue = 'Fixture City',
        confirmed_fields = '[]'::jsonb
    where id = ${DOCUMENT.mayaPassport}
  `;
  await owner()`delete from activity_events where action = 'field.revealed'`;
  await closeTestDatabase();
});

describe("what the screen is given", () => {
  test("the record, its current version, its pages and its version stack", async () => {
    const view = await asUser(USER.maya, (db) =>
      findRecordView(db, DOCUMENT.mayaPassport),
    );

    expect(view?.title).toBe("Passport");
    expect(view?.category).toBe("personal");
    expect(view?.subcategory).toBe("Passports");
    expect(view?.ownerName).toBe("Maya Adeyemi");
    expect(view?.document.versionNo).toBe(2);
    expect(view?.document.isCurrent).toBe(true);
    expect(view?.pages).toHaveLength(1);
    // The superseded passport is still there, behind the current one (D20).
    expect(view?.versions.map((v) => v.versionNo)).toEqual([2, 1]);
  });

  test("a multi-page document lists its pages in order", async () => {
    const view = await asUser(USER.priya, (db) =>
      findRecordView(db, DOCUMENT.householdDeed),
    );

    expect(view?.pages.map((p) => p.pageNo)).toEqual([1, 2]);
  });

  test("a document the viewer may not see is not there at all", async () => {
    const view = await asUser(USER.maya, (db) =>
      findRecordView(db, DOCUMENT.ivyCounselling),
    );

    expect(view).toBeNull();
  });

  test("a per-record grant shows the document without its owner", async () => {
    // Open question 4, as it reads on this screen: Sam reaches the will by
    // name and reaches nothing that says whose it is (D17).
    const view = await asUser(USER.sam, (db) =>
      findRecordView(db, DOCUMENT.roseWill),
    );

    expect(view?.title).toBe("Last will");
    expect(view?.ownerName).toBeNull();
  });
});

describe("the masked field", () => {
  test("the payload does not contain the passport number anywhere", async () => {
    // The whole rule in one assertion. Serialising the view and searching it
    // catches a field added later that carries the value along by accident.
    const view = await asUser(USER.maya, (db) =>
      findRecordView(db, DOCUMENT.mayaPassport),
    );

    expect(view?.document.hasIdentifier).toBe(true);
    expect(JSON.stringify(view)).not.toContain("FIXTURE-PP-0001");
  });

  test("revealing it returns the value", async () => {
    const value = await asUser(USER.maya, (db) =>
      revealIdentifier(db, DOCUMENT.mayaPassport),
    );

    expect(value).toBe("FIXTURE-PP-0001");
  });

  test("revealing it is written to the log before it answers", async () => {
    // D14 accepts readable identifiers in the database in exchange for exactly
    // this. A reveal that could not be recorded does not happen.
    await asUser(USER.maya, (db) => revealIdentifier(db, DOCUMENT.mayaPassport));

    const [row] = await owner()`
      select actor_user_id, subject_id from activity_events
      where action = 'field.revealed' order by at desc limit 1
    `;

    expect(row.actor_user_id).toBe(USER.maya);
    expect(row.subject_id).toBe(DOCUMENT.mayaPassport);
  });

  test("somebody who cannot see the document reveals nothing", async () => {
    const value = await asUser(USER.sam, (db) =>
      revealIdentifier(db, DOCUMENT.mayaPassport),
    );

    expect(value).toBeNull();
  });
});

describe("saving what a person typed", () => {
  test("a value typed by hand is confirmed by the act of typing it", async () => {
    await asUser(USER.maya, (db) =>
      saveFields(db, DOCUMENT.mayaPassport, { place_of_issue: "Fixture Town" }),
    );

    const view = await asUser(USER.maya, (db) =>
      findRecordView(db, DOCUMENT.mayaPassport),
    );

    expect(view?.document.placeOfIssue).toBe("Fixture Town");
    expect(view?.document.confirmedFields).toContain("place_of_issue");
  });

  test("a date is stored as a date", async () => {
    await asUser(USER.maya, (db) =>
      saveFields(db, DOCUMENT.mayaPassport, { expires_on: "2031-12-25" }),
    );

    const view = await asUser(USER.maya, (db) =>
      findRecordView(db, DOCUMENT.mayaPassport),
    );

    expect(view?.document.expiresOn).toBe("2031-12-25");
    expect(view?.document.confirmedFields).toContain("expires_on");
  });

  test("clearing a field clears its confirmation too", async () => {
    // "Nobody has said" and "somebody said it is nothing" must not look alike,
    // because only one of them is worth asking a reader to fill in.
    await asUser(USER.maya, (db) =>
      saveFields(db, DOCUMENT.mayaPassport, { place_of_issue: "" }),
    );

    const view = await asUser(USER.maya, (db) =>
      findRecordView(db, DOCUMENT.mayaPassport),
    );

    expect(view?.document.placeOfIssue).toBeNull();
    expect(view?.document.confirmedFields).not.toContain("place_of_issue");
  });

  test("somebody who cannot see the document changes nothing", async () => {
    await asUser(USER.sam, (db) =>
      saveFields(db, DOCUMENT.mayaPassport, { place_of_issue: "Elsewhere" }),
    );

    const [row] = await owner()`
      select place_of_issue from documents where id = ${DOCUMENT.mayaPassport}
    `;

    expect(row.place_of_issue).toBeNull();
  });
});
