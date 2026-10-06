/**
 * What a backup is worth to somebody who has it and not the key.
 *
 * The drill (`npm run backup:drill`) is what proves a real backup restores —
 * it needs Docker, a database and a store, so it is a command rather than a
 * test. These are the parts that can be pinned without any of that: that the
 * dump is sealed rather than written, that it refuses to open under the wrong
 * key or after tampering, and that the finished backup is searched for key
 * material rather than trusted not to contain any.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  assertNoKeyMaterial,
  MANIFEST_VERSION,
  openDump,
  sealDump,
  type Manifest,
} from "./backup.server";
import { keyProviderFrom } from "./keys.server";

const KEK = keyProviderFrom(Buffer.alloc(32, 3));
const OTHER = keyProviderFrom(Buffer.alloc(32, 4));

const BACKUP_ID = "safehouse-2026-10-06T00-00-00-000Z";

/** A dump looks like this, and contains exactly what D14 says it does. */
const DUMP = Buffer.from(
  `--
-- PostgreSQL database dump
--
COPY public.documents (id, identifier) FROM stdin;
0000  FIXTURE-PP-0001
\\.
`,
  "utf8",
);

function manifestFor(database: Manifest["database"]): Manifest {
  return {
    version: MANIFEST_VERSION,
    backupId: BACKUP_ID,
    createdAt: "2026-10-06T00:00:00.000Z",
    database,
    counts: { documents: 36, files: 17, storedBlobs: 17 },
  };
}

describe("the database half", () => {
  test("round-trips", () => {
    const { stored, database } = sealDump(DUMP, BACKUP_ID, KEK);

    expect(openDump(stored, manifestFor(database), KEK).equals(DUMP)).toBe(true);
  });

  test("what is written is not the dump", () => {
    // A plaintext backup defeats D5, and the identifiers D14 accepts in the
    // database are exactly what would be sitting on the USB stick.
    const { stored } = sealDump(DUMP, BACKUP_ID, KEK);

    expect(stored.equals(DUMP)).toBe(false);
    expect(stored.includes(Buffer.from("FIXTURE-PP-0001"))).toBe(false);
    expect(stored.includes(Buffer.from("PostgreSQL"))).toBe(false);
  });

  test("does not open under another key", () => {
    const { stored, database } = sealDump(DUMP, BACKUP_ID, KEK);

    expect(() => openDump(stored, manifestFor(database), OTHER)).toThrow();
  });

  test("does not open if the ciphertext was edited", () => {
    const { stored, database } = sealDump(DUMP, BACKUP_ID, KEK);
    stored[10] ^= 0xff;

    expect(() => openDump(stored, manifestFor(database), KEK)).toThrow();
  });

  test("does not open under another backup's identity", () => {
    // The backup id is authenticated, so a dump cannot be lifted into a
    // different backup's folder and manifest and pass as that backup.
    const { stored, database } = sealDump(DUMP, BACKUP_ID, KEK);
    const elsewhere = { ...manifestFor(database), backupId: "safehouse-other" };

    expect(() => openDump(stored, elsewhere, KEK)).toThrow();
  });

  test("refuses a manifest version it does not understand", () => {
    const { stored, database } = sealDump(DUMP, BACKUP_ID, KEK);
    const future = { ...manifestFor(database), version: 99 };

    expect(() => openDump(stored, future, KEK)).toThrow(/version 99/);
  });
});

describe("searching the finished backup for the key", () => {
  async function backup(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "safehouse-backup-"));
    const { stored, database } = sealDump(DUMP, BACKUP_ID, KEK);

    await writeFile(join(dir, "database.enc"), stored);
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify(manifestFor(database)),
    );
    await mkdir(join(dir, "storage", "ab"), { recursive: true });
    await writeFile(join(dir, "storage", "ab", "sealed"), Buffer.from("sealed"));

    return dir;
  }

  test("a clean backup passes", async () => {
    await expect(assertNoKeyMaterial(await backup(), KEK.kek())).resolves
      .toBeUndefined();
  });

  test("catches the key copied in as a file", async () => {
    // The mistake this exists for: somebody helpfully adding the key to a
    // backup script so restores are easier, which is silent until the day the
    // backup is stolen.
    const dir = await backup();
    await writeFile(join(dir, "safehouse.key"), KEK.kek().toString("hex"));

    await expect(assertNoKeyMaterial(dir, KEK.kek())).rejects.toThrow(/key material/);
  });

  test("catches it base64-encoded inside another file", async () => {
    const dir = await backup();
    await writeFile(
      join(dir, "notes.txt"),
      `restore with: ${KEK.kek().toString("base64")}\n`,
    );

    await expect(assertNoKeyMaterial(dir, KEK.kek())).rejects.toThrow(/key material/);
  });

  test("catches raw key bytes in a binary file", async () => {
    const dir = await backup();
    await writeFile(
      join(dir, "something.bin"),
      Buffer.concat([Buffer.from("x"), KEK.kek(), Buffer.from("y")]),
    );

    await expect(assertNoKeyMaterial(dir, KEK.kek())).rejects.toThrow(/key material/);
  });

  test("does not cry wolf over the sealed blobs", async () => {
    // Ciphertext is high-entropy and a scan of it proves nothing, so the
    // store is skipped on purpose. This pins that choice.
    const dir = await backup();
    await writeFile(join(dir, "storage", "ab", "sealed"), KEK.kek());

    await expect(assertNoKeyMaterial(dir, KEK.kek())).resolves.toBeUndefined();
  });
});
