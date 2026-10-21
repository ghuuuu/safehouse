/**
 * Encrypted blobs on local disk (D12 — local storage, nothing to a third party).
 *
 * This module never sees a plaintext. What it is handed is already sealed by
 * `crypto.server.ts`, and what it hands back is still sealed. Keeping the
 * decision about *what* to write away from the decision about *where* means
 * the storage layer has nothing worth stealing in it.
 *
 * The storage key carries no meaning on purpose. A path like
 * `maya/passport-2024.jpg` would put a record field value into a directory
 * listing, a backup manifest, and every error that prints a path — CLAUDE.md
 * says never log file names, and a name that is itself the data makes that
 * impossible to honour.
 */

import { access, constants, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { requireEnv } from "./config.server";

/** `ab/<uuid>` — derived from the row id, fanned out so no directory holds everything. */
const STORAGE_KEY =
  /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function storageKeyFor(fileId: string): string {
  const id = fileId.toLowerCase();
  const key = `${id.slice(0, 2)}/${id}`;

  if (!STORAGE_KEY.test(key)) {
    throw new Error("A storage key is derived from a file id and that was not one.");
  }

  return key;
}

export function storageDir(): string {
  return requireEnv("SAFEHOUSE_STORAGE_DIR");
}

/**
 * Run at boot, so a store this server cannot write stops it now rather than
 * failing the first upload. Under Compose the store is a host directory (D38),
 * and Docker creates a missing one owned by root.
 */
export async function checkStoreAtBoot(): Promise<void> {
  const dir = storageDir();
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
  } catch {
    throw new Error(
      `The document store ${dir} is not writable by this server. Refusing to start. ` +
        `Under Docker Compose: chown 1000:1000 the host directory (docs/OPERATIONS.md).`,
    );
  }
}

/**
 * Resolve a key inside the store, refusing anything that climbs out of it.
 *
 * The pattern above already excludes `..`, and this checks the resolved path
 * anyway: the one that matters is the check that survives somebody later
 * loosening the pattern.
 */
function pathFor(key: string, dir: string): string {
  if (!STORAGE_KEY.test(key)) {
    throw new Error("Refusing a storage key that is not in the expected shape.");
  }

  const root = resolve(dir);
  const path = resolve(join(root, key));

  if (path !== root && !path.startsWith(root + sep)) {
    throw new Error("Refusing a storage key that resolves outside the store.");
  }

  return path;
}

/**
 * Write sealed bytes.
 *
 * Written to a temporary name and renamed, because a half-written file that
 * looks like a whole one is a document that fails to open months later, with
 * nothing to say whether the disk or the key was at fault. Rename is atomic on
 * the same filesystem.
 *
 * Synced before the rename, and the directory after it, because the caller
 * commits the row pointing here as soon as this returns. A power cut after
 * that commit must not find an empty file, or no file, under the name.
 */
export async function putBlob(
  key: string,
  sealed: Buffer,
  dir: string = storageDir(),
): Promise<void> {
  const path = pathFor(key, dir);
  const temporary = `${path}.partial`;

  await mkdir(dirname(path), { recursive: true });
  const file = await open(temporary, "w", 0o600);
  try {
    await file.writeFile(sealed);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);

  // Windows cannot open a directory to sync it, and has no need to.
  if (process.platform !== "win32") {
    const folder = await open(dirname(path), "r");
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
  }
}

export async function getBlob(
  key: string,
  dir: string = storageDir(),
): Promise<Buffer> {
  return readFile(pathFor(key, dir));
}

export async function hasBlob(
  key: string,
  dir: string = storageDir(),
): Promise<boolean> {
  try {
    await readFile(pathFor(key, dir));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove sealed bytes. Quiet if they are already gone, so that cleaning up
 * after a failed upload cannot itself fail.
 */
export async function deleteBlob(
  key: string,
  dir: string = storageDir(),
): Promise<void> {
  await rm(pathFor(key, dir), { force: true });
}
