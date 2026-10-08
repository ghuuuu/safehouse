/**
 * Bulk intake (Step 15): one file at a time, read on the way in.
 *
 * `upload.test.ts` already proves filing itself: the rows, the sealed blob, the
 * refusals. What is new here is what happens around it. The reader runs on
 * the uploaded bytes, and the filing and what the reader proposed land in one
 * transaction. A reader that fails must not lose the document, and a refused
 * filing must not leave a proposal, a blob or a log line behind.
 *
 * The reader is handed in. These tests are about the wiring; the reader has
 * its own (`ocr.server.test.ts`, `terms.server.test.ts`).
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ReadResult } from "../ocr.server";
import { OWNER, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

const MARK = "TEST-BULK";

let store: string;
let asUser: typeof import("../db.server").asUser;
let bulk: typeof import("../bulk.server");

beforeAll(async () => {
  await prepareTestDatabase();

  store = await mkdtemp(join(tmpdir(), "safehouse-bulk-"));
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
  bulk = await import("../bulk.server");
}, 60_000);

afterAll(async () => {
  await owner()`delete from records where title like ${`${MARK}%`} or title like '% document'`;
  await closeTestDatabase();
});

const BYTES = Buffer.from(`%PDF-1.4 fictional bulk scan ${"x".repeat(200)}`);

/** What the reader would say about a fictional passport. */
const READ: ReadResult = {
  proposals: [
    { field: "expires_on", value: "2033-04-30", source: "mrz", verified: true },
    { field: "identifier", value: "FIXTURE-BULK-0001", source: "mrz", verified: true },
  ],
  text: "",
  how: "Read from the machine-readable strip.",
};

function filing(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: OWNER.maya,
    category: "personal",
    title: `${MARK} passport`,
    mime: "application/pdf",
    bytes: BYTES,
    ...overrides,
  } as Parameters<typeof import("../bulk.server").fileAndRead>[1];
}

async function stored(documentId: string) {
  const [row] = await owner()`
    select d.expires_on::text as expires, d.confirmed_fields as confirmed, d.identifier,
           d.identifier_sealed is not null as sealed, r.title
    from documents d join records r on r.id = d.record_id where d.id = ${documentId}
  `;
  return row;
}

async function blobCount() {
  // Files only: the store fans out into `ab/` directories, which stay.
  const entries = await readdir(store, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile() && !e.name.endsWith(".key")).length;
}

function code(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code ?? "";
}

describe("reading on the way in", () => {
  test("a filed document arrives with what the reader proposed, none of it confirmed", async () => {
    const filed = await asUser(USER.maya, (db) => bulk.fileAndRead(db, filing(), READ));
    const row = await stored(filed.documentId);

    expect(filed.proposed).toBe(2);
    expect(row.expires).toBe("2033-04-30");
    expect(row.confirmed).toEqual([]);
    // The number is sealed like every other (D35), never written in the clear.
    expect([row.identifier, row.sealed]).toEqual([null, true]);
  });

  test("a reader that fails still files the document, with nothing proposed", async () => {
    const read = await bulk.readSafely(BYTES, "application/pdf", async () => {
      throw new Error("the reader fell over");
    });
    const filed = await asUser(USER.maya, (db) => bulk.fileAndRead(db, filing(), read));

    expect(read).toBeNull();
    expect(filed.proposed).toBe(0);
    expect((await stored(filed.documentId)).expires).toBeNull();
  });

  test("a blank title is named after its kind, never after the file", async () => {
    const filed = await asUser(USER.maya, (db) =>
      bulk.fileAndRead(db, filing({ title: "  ", category: "medical" }), null),
    );
    expect((await stored(filed.documentId)).title).toBe("Medical document");
  });
});

describe("a refusal leaves nothing", () => {
  test("a third party is refused by the database, and no blob, row or proposal survives", async () => {
    const before = await blobCount();
    const [{ n: rowsBefore }] = await owner()`select count(*)::int as n from documents`;

    const error = await asUser(USER.sam, (db) =>
      bulk.fileAndRead(db, filing({ ownerId: OWNER.hale, category: "business" }), READ),
    ).catch((e) => e);

    expect(code(error)).toBe("42501");
    expect(await blobCount()).toBe(before);
    const [{ n: rowsAfter }] = await owner()`select count(*)::int as n from documents`;
    expect(rowsAfter).toBe(rowsBefore);
  });

  test("a member filing for somebody outside their circle is refused the same way", async () => {
    const error = await asUser(USER.maya, (db) =>
      bulk.fileAndRead(db, filing({ ownerId: OWNER.nadia }), READ),
    ).catch((e) => e);
    expect(code(error)).toBe("42501");
  });

  test("a proposal that cannot be saved takes the filing back with it", async () => {
    const before = await blobCount();
    const broken: ReadResult = { ...READ, proposals: [{ field: "expires_on", value: "not a date", source: "mrz", verified: false }] };

    const error = await asUser(USER.maya, (db) =>
      bulk.fileAndRead(db, filing({ title: `${MARK} unsaveable` }), broken),
    ).catch((e) => e);

    expect(code(error)).toBe("22007");
    const [{ n }] = await owner()`select count(*)::int as n from records where title = ${`${MARK} unsaveable`}`;
    expect(n).toBe(0);
    // The blob was already on disk when the proposal failed. It goes too,
    // rather than sitting in the store with nothing pointing at it.
    expect(await blobCount()).toBe(before);
  });
});

describe("what it logs", () => {
  test("one filing line per document, and no value in it", async () => {
    const filed = await asUser(USER.maya, (db) => bulk.fileAndRead(db, filing(), READ));
    const lines = await asUser(USER.priya, (db) =>
      db.execute<{ action: string }>(sql`
        select action from activity_events where subject_id = ${filed.documentId}
      `),
    );
    expect([...lines].map((l) => l.action)).toEqual(["document.filed"]);
  });
});
