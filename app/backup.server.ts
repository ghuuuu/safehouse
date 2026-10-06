/**
 * Backups, which D6 says are part of the product rather than an afterthought,
 * and which it says in as many words block putting real documents in.
 *
 * Two halves, treated differently on purpose:
 *
 *   The database is dumped and then encrypted. A plaintext dump defeats D5
 *   entirely — D14 accepts that record field values sit readable in the
 *   database on the condition that the database is never reachable from
 *   outside, and a dump on a USB stick is as outside as it gets.
 *
 *   The document files are copied exactly as they are. They are already sealed
 *   individually (D12), so re-encrypting them would add a second lock to a
 *   locked door and double the size of every backup. What a backup of the
 *   store is worth without the key is what the store itself is worth without
 *   the key: nothing.
 *
 * The key file is in neither half, by construction rather than by a rule
 * somebody has to remember. Nothing in this module reads it except to encrypt
 * with it, and `assertNoKeyMaterial` checks the finished backup for it anyway,
 * because "by construction" is a claim worth testing.
 *
 * Losing the key loses every backup as well as the live vault. That is the
 * trade D12 already made, and the alternative — a backup openable without the
 * key — is just a plaintext backup with extra steps.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { openFile, sealFile } from "./crypto.server";
import { keys, type KeyProvider } from "./keys.server";

export const MANIFEST_VERSION = 1;

export type Manifest = {
  version: number;
  /** Identifies this backup, and is authenticated into the dump's ciphertext. */
  backupId: string;
  createdAt: string;
  database: {
    /** Of the plaintext dump, so a restore can prove what came back. */
    sha256: string;
    byteSize: number;
    nonce: string;
    wrappedDek: string;
  };
  counts: {
    documents: number;
    files: number;
    storedBlobs: number;
  };
};

/** Seal a database dump for one backup. */
export function sealDump(
  dump: Buffer,
  backupId: string,
  provider: KeyProvider = keys(),
): { stored: Buffer; database: Manifest["database"] } {
  const sealed = sealFile(dump, backupId, provider);

  return {
    stored: sealed.stored,
    database: {
      sha256: sealed.sha256,
      byteSize: sealed.byteSize,
      nonce: sealed.nonce.toString("base64"),
      wrappedDek: sealed.wrappedDek.toString("base64"),
    },
  };
}

/**
 * Open a sealed dump. Throws rather than returning anything partial: a restore
 * from a backup that is not quite right is worse than a restore that stops.
 */
export function openDump(
  stored: Buffer,
  manifest: Manifest,
  provider: KeyProvider = keys(),
): Buffer {
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(
      `This backup is version ${manifest.version}; this code reads ${MANIFEST_VERSION}.`,
    );
  }

  return openFile(
    {
      stored,
      nonce: Buffer.from(manifest.database.nonce, "base64"),
      wrappedDek: Buffer.from(manifest.database.wrappedDek, "base64"),
    },
    manifest.backupId,
    provider,
  );
}

/**
 * Walk a finished backup and refuse it if anything in it could be a key.
 *
 * The check is deliberately crude and deliberately loud. It looks for the
 * 64-hex and base64 shapes `keys.server.ts` accepts, anywhere in any file
 * outside the sealed blobs — because the failure it guards against is somebody
 * helpfully adding `cp keys/safehouse.key $DEST` to a backup script one day, and
 * that mistake is silent until the day the backup is stolen.
 */
export async function assertNoKeyMaterial(
  dir: string,
  kek: Buffer,
): Promise<void> {
  const hex = kek.toString("hex");
  const base64 = kek.toString("base64");

  for (const path of await walk(dir)) {
    // The sealed blobs are ciphertext; scanning them is pointless and a
    // coincidental match is impossible to act on anyway.
    if (path.includes(`${join(dir, "storage")}`)) continue;

    const bytes = await readFile(path);
    const text = bytes.toString("latin1");

    if (bytes.includes(kek) || text.includes(hex) || text.includes(base64)) {
      throw new Error(
        `Refusing this backup: key material appears in ${path}. A backup that ` +
          `carries the key is a plaintext backup (D12).`,
      );
    }
  }
}

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(path)));
    else found.push(path);
  }

  return found;
}

/** Every sealed blob in a store, as storage keys. */
export async function listBlobs(storeDir: string): Promise<string[]> {
  const keysFound: string[] = [];

  for (const entry of await readdir(storeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    for (const file of await readdir(join(storeDir, entry.name))) {
      const path = join(storeDir, entry.name, file);
      if ((await stat(path)).isFile()) keysFound.push(`${entry.name}/${file}`);
    }
  }

  return keysFound.sort();
}
