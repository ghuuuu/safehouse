/**
 * The vault as folders, and a chosen set of it as one ZIP (D41): the tree is
 * shaped right, names cannot climb out of their folder, and a download hands
 * over exactly what the policies allow, records every file, and refuses the
 * whole thing when any id is out of reach. Every byte is fictional.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { DOCUMENT, OWNER, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

const MARK = "TEST-FOLDERS";

let asUser: typeof import("../db.server").asUser;
let folders: typeof import("../folders.server");

beforeAll(async () => {
  await prepareTestDatabase();
  const store = await mkdtemp(join(tmpdir(), "safehouse-folders-"));
  process.env.SAFEHOUSE_STORAGE_DIR = store;
  const keyFile = join(store, "test.key");
  await writeFile(keyFile, randomBytes(32).toString("hex"));
  process.env.SAFEHOUSE_KEY_FILE = keyFile;

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
  folders = await import("../folders.server");
}, 60_000);

afterAll(async () => {
  await owner()`delete from records where title like ${`${MARK}%`}`;
  await closeTestDatabase();
});

const row = (over: Partial<Parameters<typeof import("../folders.server").buildTree>[0][number]>) => ({
  id: "d", title: "Paper", category: "personal", ownerName: "Maya Adeyemi", versionNo: 1, isCurrent: true, fileCount: 1, isPdf: true,
  ...over,
});

describe("the tree", () => {
  test("whose, then what kind; earlier versions apart; shared-with-me last; nothing without a file", () => {
    const tree = folders.buildTree([
      row({ id: "a", ownerName: null, category: "business" }),
      row({ id: "b", category: "medical" }),
      row({ id: "c", versionNo: 2 }),
      row({ id: "d", isCurrent: false }),
      row({ id: "e", ownerName: "Daniel Hale" }),
      row({ id: "f", fileCount: 0 }),
    ]);
    expect(tree.map((f) => f.owner)).toEqual(["Daniel Hale", "Maya Adeyemi", "Shared with me"]);
    const maya = tree[1];
    expect(maya.categories.map((c) => c.category)).toEqual(["medical", "personal"]);
    expect(maya.categories[1].current.map((d) => d.id)).toEqual(["c"]);
    expect(maya.categories[1].earlier.map((d) => d.id)).toEqual(["d"]);
  });

  test("paths in the ZIP stay in their folder and never collide", () => {
    const base = { mime: "application/pdf", pageNo: 1, category: "personal", versionNo: 1, isCurrent: true };
    const paths = folders.zipPaths([
      { ...base, id: "1", title: "Passport", ownerName: "Maya Adeyemi" },
      { ...base, id: "2", title: "passport", ownerName: "Maya Adeyemi" },
      { ...base, id: "3", title: "Passport", ownerName: "Maya Adeyemi", isCurrent: false, versionNo: 1 },
      { ...base, id: "4", title: "../../etc/passwd", ownerName: "../Somebody" },
      { ...base, id: "5", title: "Will", ownerName: null, category: "legal" },
    ]);
    expect([...paths.values()]).toEqual([
      "Maya Adeyemi/Personal/Passport.pdf",
      "Maya Adeyemi/Personal/passport (2).pdf",
      "Maya Adeyemi/Personal/Earlier versions/Passport version 1.pdf",
      "Somebody/Personal/etcpasswd.pdf",
      "Shared with me/Legal/Will.pdf",
    ]);
  });
});

describe("downloading", () => {
  async function filedPdf(title: string) {
    const { fileDocument } = await import("../upload.server");
    const bytes = Buffer.from(`%PDF-1.4 ${title} ${"x".repeat(200)}`);
    const filed = await asUser(USER.maya, (db) =>
      fileDocument(db, { ownerId: OWNER.maya, category: "personal", title, mime: "application/pdf", bytes }),
    );
    return { ...filed, bytes };
  }

  test("what was chosen comes back where the folders say, and each file is recorded", async () => {
    const paper = await filedPdf(`${MARK} card`);
    const zip = await asUser(USER.maya, (db) => folders.zipDocuments(db, [paper.documentId]));
    const files = unzipSync(zip);

    expect(Object.keys(files)).toEqual([`Maya Adeyemi/Personal/${MARK} card.pdf`]);
    expect(Buffer.from(Object.values(files)[0]).equals(paper.bytes)).toBe(true);

    const logged = await owner()`
      select count(*)::int as n from activity_events
      where action = 'document.downloaded' and subject_id = ${paper.fileId}
    `;
    expect(logged[0].n).toBe(1);
  });

  test("one id out of reach refuses the whole download and records nothing", async () => {
    const paper = await filedPdf(`${MARK} mine`);
    const outcome = await asUser(USER.maya, (db) => folders.zipDocuments(db, [paper.documentId, DOCUMENT.nadiaPassport])).catch(
      (e: Response) => e.status,
    );
    expect(outcome).toBe(404);

    const logged = await owner()`
      select count(*)::int as n from activity_events
      where action = 'document.downloaded' and subject_id = ${paper.fileId}
    `;
    expect(logged[0].n).toBe(0);
  });

  test("an id that is not an id is not a database error", async () => {
    const outcome = await asUser(USER.maya, (db) => folders.zipDocuments(db, ["'; drop table records; --"])).catch(
      (e: Response) => e.status,
    );
    expect(outcome).toBe(404);
  });

  test("the tree holds exactly the vault list", async () => {
    const tree = await asUser(USER.maya, (db) => folders.folderTree(db));
    const ids = tree.flatMap((f) => f.categories.flatMap((c) => [...c.current, ...c.earlier].map((d) => d.id)));
    expect(ids).not.toContain(DOCUMENT.nadiaPassport);
    expect(ids).toContain(DOCUMENT.mayaPassport);
  });
});
