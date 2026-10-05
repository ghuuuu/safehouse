/**
 * Where sealed bytes land, and the paths this module refuses.
 *
 * Every test runs against its own temporary directory. A storage test pointed
 * at the real store is a test that can delete somebody's passport.
 */

import { readdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  deleteBlob,
  getBlob,
  hasBlob,
  putBlob,
  storageKeyFor,
} from "./storage.server";

const FILE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const SEALED = Buffer.from("sealed bytes, meaningless without the key");

function store(): Promise<string> {
  return mkdtemp(join(tmpdir(), "safehouse-store-"));
}

describe("the storage key", () => {
  test("is derived from the file id and fans out by its first two characters", () => {
    expect(storageKeyFor(FILE_ID)).toBe(`3f/${FILE_ID}`);
  });

  test("carries nothing about the document", () => {
    // Deliberately asserted: the day somebody makes this readable is the day a
    // record field value appears in a backup manifest.
    const key = storageKeyFor(FILE_ID);

    expect(key).not.toMatch(/passport|maya|\.(jpg|pdf)$/i);
  });

  test("refuses anything that is not a file id", () => {
    expect(() => storageKeyFor("../../etc/passwd")).toThrow();
    expect(() => storageKeyFor("")).toThrow();
    expect(() => storageKeyFor("not-a-uuid")).toThrow();
  });
});

describe("putting and getting", () => {
  test("bytes come back exactly", async () => {
    const dir = await store();
    const key = storageKeyFor(FILE_ID);

    await putBlob(key, SEALED, dir);

    expect((await getBlob(key, dir)).equals(SEALED)).toBe(true);
    expect(await hasBlob(key, dir)).toBe(true);
  });

  test("writing twice leaves one file and the later bytes", async () => {
    const dir = await store();
    const key = storageKeyFor(FILE_ID);
    const second = Buffer.from("a replacement page");

    await putBlob(key, SEALED, dir);
    await putBlob(key, second, dir);

    expect((await getBlob(key, dir)).equals(second)).toBe(true);
    // No .partial left behind: a half-written file that looks whole is a
    // document that fails to open months later with nothing to explain it.
    expect(await readdir(join(dir, "3f"))).toEqual([FILE_ID]);
  });

  test("a missing blob is a missing blob, not an empty one", async () => {
    const dir = await store();

    await expect(getBlob(storageKeyFor(FILE_ID), dir)).rejects.toThrow();
    expect(await hasBlob(storageKeyFor(FILE_ID), dir)).toBe(false);
  });

  test("deleting is quiet when there is nothing there", async () => {
    const dir = await store();

    await expect(deleteBlob(storageKeyFor(FILE_ID), dir)).resolves.toBeUndefined();
  });

  test("deleting removes the bytes", async () => {
    const dir = await store();
    const key = storageKeyFor(FILE_ID);

    await putBlob(key, SEALED, dir);
    await deleteBlob(key, dir);

    expect(await hasBlob(key, dir)).toBe(false);
  });
});

describe("paths this refuses", () => {
  const escapes = [
    "../../../etc/passwd",
    "3f/../../../etc/passwd",
    "3f/3fa85f64-5717-4562-b3fc-2c963f66afa6/../../escape",
    "/absolute/path",
    "3f\\3fa85f64-5717-4562-b3fc-2c963f66afa6",
  ];

  test.each(escapes)("refuses %s", async (key) => {
    const dir = await store();

    await expect(putBlob(key, SEALED, dir)).rejects.toThrow();
    await expect(getBlob(key, dir)).rejects.toThrow();
  });

  test("a file written outside the store is never created", async () => {
    const dir = await store();
    const outside = join(dir, "outside.txt");
    await writeFile(outside, "original");

    await expect(putBlob("../outside.txt", SEALED, dir)).rejects.toThrow();
    expect((await getBlob(storageKeyFor(FILE_ID), dir).catch(() => null))).toBeNull();
  });
});
