/**
 * Filing a document, end to end, against real policies and a real disk.
 *
 * The question these answer is not "does an insert work" — `writes.test.ts`
 * covers the policy. It is whether the three rows, the sealed blob and the
 * refusals line up: that nothing reaches the disk when the database says no,
 * that nothing survives in the database when the disk says no, and that what
 * comes back out is what went in.
 *
 * These run through the application's own drizzle connection rather than the
 * harness's raw one, because the ordering inside `fileDocument` is part of
 * what is being tested and a re-implementation of it here would prove nothing.
 * Everything they write is removed afterwards by title.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { openFile } from "../crypto.server";
import { storageKeyFor } from "../storage.server";
import { fileDocument, MAX_FILED_BYTES, UploadRefused } from "../upload.server";
import { OWNER, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

/** Every row these tests make says so in its title, and is swept by it. */
const MARK = "TEST-UPLOAD";

let store: string;
let asUser: typeof import("../db.server").asUser;

/** Recognisable bytes, so "did the plaintext reach the disk" is answerable. */
const PDF = Buffer.from(
  `%PDF-1.4 fictional scan FIXTURE-UPLOAD-0001 ${"x".repeat(500)}`,
  "utf8",
);

beforeAll(async () => {
  await prepareTestDatabase();

  store = await mkdtemp(join(tmpdir(), "safehouse-upload-"));
  process.env.SAFEHOUSE_STORAGE_DIR = store;

  // Its own key, so these tests neither need nor can touch a real vault's.
  const keyFile = join(store, "test.key");
  await writeFile(keyFile, randomBytes(32).toString("hex"));
  process.env.SAFEHOUSE_KEY_FILE = keyFile;

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
}, 60_000);

afterAll(async () => {
  await owner()`delete from records where title like ${`${MARK}%`}`;
  await closeTestDatabase();
});

function filing(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: OWNER.maya,
    category: "general" as const,
    title: `${MARK} filed by a test`,
    mime: "application/pdf",
    bytes: PDF,
    ...overrides,
  } as Parameters<typeof fileDocument>[1];
}

/** The Postgres error code, or null when it succeeded. */
async function refusalCode(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? "";
  }
}

describe("what a filing produces", () => {
  test("three rows and one sealed file", async () => {
    const filed = await asUser(USER.maya, (db) => fileDocument(db, filing()));

    const [row] = await owner()`
      select r.title, r.category, r.owner_id, d.version_no, d.is_current,
             f.storage_key, f.byte_size, f.mime
      from records r
      join documents d on d.record_id = r.id
      join document_files f on f.document_id = d.id
      where r.id = ${filed.recordId}
    `;

    expect(row.owner_id).toBe(OWNER.maya);
    expect(row.version_no).toBe(1);
    expect(row.is_current).toBe(true);
    expect(row.byte_size).toBe(PDF.length);
    expect(row.mime).toBe("application/pdf");
    expect(row.storage_key).toBe(storageKeyFor(filed.fileId));
  });

  test("what landed on disk is not what was uploaded", async () => {
    const filed = await asUser(USER.maya, (db) => fileDocument(db, filing()));

    const stored = await readFile(join(store, storageKeyFor(filed.fileId)));

    expect(stored.equals(PDF)).toBe(false);
    expect(stored.includes(Buffer.from("FIXTURE-UPLOAD-0001"))).toBe(false);
    expect(stored.length).toBe(PDF.length + 16);
  });

  test("and it opens back to exactly what was uploaded", async () => {
    const filed = await asUser(USER.maya, (db) => fileDocument(db, filing()));

    const [row] = await owner()`
      select wrapped_dek, nonce, sha256 from document_files where id = ${filed.fileId}
    `;
    const stored = await readFile(join(store, storageKeyFor(filed.fileId)));

    const opened = openFile(
      {
        stored,
        nonce: Buffer.from(row.nonce as Buffer),
        wrappedDek: Buffer.from(row.wrapped_dek as Buffer),
      },
      filed.fileId,
    );

    expect(opened.equals(PDF)).toBe(true);
    // The digest a restore drill compares against is of the plaintext (D6).
    expect(row.sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
  });

  test("the file's own name is never stored anywhere", async () => {
    // A storage key that said "maya-passport.pdf" would put a record field
    // value in a directory listing and in every backup manifest (CLAUDE.md).
    const filed = await asUser(USER.maya, (db) =>
      fileDocument(db, filing({ title: `${MARK} Passport scan` })),
    );

    expect(storageKeyFor(filed.fileId)).not.toMatch(/passport|scan|pdf/i);
  });
});

describe("what the database refuses, the disk never sees", () => {
  test("filing for an owner out of reach writes no bytes", async () => {
    // Nadia is outside Maya's circle. The rows go in before the blob precisely
    // so that this refusal costs nothing on disk.
    const before = await readdir(store, { recursive: true });

    const code = await refusalCode(() =>
      asUser(USER.maya, (db) => fileDocument(db, filing({ ownerId: OWNER.nadia }))),
    );

    expect(code).toBe("42501");
    expect(await readdir(store, { recursive: true })).toEqual(before);
  });

  test("a third party cannot file at all", async () => {
    const code = await refusalCode(() =>
      asUser(USER.sam, (db) => fileDocument(db, filing({ ownerId: OWNER.hale }))),
    );

    expect(code).toBe("42501");
  });

  test("an emergency contact cannot file during an open window", async () => {
    const code = await refusalCode(() =>
      asUser(USER.medic, (db) => fileDocument(db, filing({ ownerId: OWNER.ivy }))),
    );

    expect(code).toBe("42501");
  });

  test("a refused filing leaves no row behind either", async () => {
    await refusalCode(() =>
      asUser(USER.maya, (db) =>
        fileDocument(db, filing({ ownerId: OWNER.nadia, title: `${MARK} ghost` })),
      ),
    );

    const rows = await owner()`
      select id from records where title = ${`${MARK} ghost`}
    `;

    expect(rows).toHaveLength(0);
  });
});

describe("what this module refuses before the database is asked", () => {
  const refused: [string, Record<string, unknown>][] = [
    ["an empty file", { bytes: Buffer.alloc(0) }],
    ["a file type a vault should not hold", { mime: "application/x-msdownload" }],
    ["a document with no name", { title: "   " }],
    ["a category that is not one", { category: "invented" }],
    ["an owner id that is not an id", { ownerId: "../../etc/passwd" }],
  ];

  test.each(refused)("refuses %s", async (_what, overrides) => {
    await expect(
      asUser(USER.maya, (db) => fileDocument(db, filing(overrides))),
    ).rejects.toBeInstanceOf(UploadRefused);
  });

  test("takes a built PDF over the upload limit, which only each upload has to meet", async () => {
    // Five phone photos, each well under the limit, become one PDF that keeps
    // every original (D39). That PDF was refused for being over 25 MB.
    const built = Buffer.alloc(30 * 1024 * 1024);

    await expect(
      asUser(USER.maya, (db) => fileDocument(db, filing({ bytes: built }))),
    ).resolves.toHaveProperty("fileId");
  });

  test("refuses a paper over the ceiling for one built file", async () => {
    const huge = Buffer.alloc(MAX_FILED_BYTES + 1);

    await expect(
      asUser(USER.maya, (db) => fileDocument(db, filing({ bytes: huge }))),
    ).rejects.toThrow(/File it as two/);
  });
});

describe("what the filer can see afterwards", () => {
  test("a filed document is in the filer's own vault", async () => {
    const filed = await asUser(USER.daniel, (db) =>
      fileDocument(db, filing({ ownerId: OWNER.daniel, title: `${MARK} Daniel's` })),
    );

    const seen = await asUser(USER.daniel, async (db) => {
      const rows = await db.execute<{ id: string }>(
        sql`select id from documents where id = ${filed.documentId}`,
      );
      return [...rows].length;
    });

    expect(seen).toBe(1);
  });

  test("filing for the household puts it in another member's vault too", async () => {
    const filed = await asUser(USER.maya, (db) =>
      fileDocument(db, filing({ ownerId: OWNER.household, title: `${MARK} household` })),
    );

    const seenByDaniel = await asUser(USER.daniel, async (db) => {
      const rows = await db.execute<{ id: string }>(
        sql`select id from records where id = ${filed.recordId}`,
      );
      return [...rows].length;
    });

    expect(seenByDaniel).toBe(1);
  });
});
