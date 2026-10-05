/**
 * The one key every document key is wrapped with (D12).
 *
 * It lives in a file mounted as a secret, is read once at boot, and is never
 * written to the database, to the document store, or to a backup. Losing it
 * loses every document in the vault, which is why its custody — printed,
 * offline, somewhere else — is part of the backup work rather than an
 * afterthought.
 *
 * It arrives through a provider rather than from a path read inline because
 * D12 requires that adding passphrase unlock later must not touch the schema.
 * One implementation today; the second one will be a different function
 * returning the same shape.
 *
 * Nothing in this module prints key material, including in errors. An error
 * that quotes the value it rejected would put the key in a log the first time
 * somebody fat-fingers the file.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { requireEnv } from "./config.server";

export type KeyProvider = {
  /** The key-encryption key: 32 bytes, for AES-256-GCM. */
  kek(): Buffer;
  /**
   * Four bytes identifying which key this is, without revealing any of it.
   *
   * Written into every wrapped data key so that rotation can tell what it has
   * already done. A rotation interrupted halfway leaves rows wrapped under two
   * different keys, and without this there is no way to tell them apart except
   * by trying to unwrap and seeing what fails — which is how a vault loses
   * files.
   */
  keyId(): Buffer;
};

const KEY_BYTES = 32;
const HEX = /^[0-9a-f]{64}$/i;

/**
 * Accept the key as hex or base64, because D12 asks for custody that includes a
 * printed copy, and a person has to be able to type it back in.
 */
export function parseKeyMaterial(text: string, source: string): Buffer {
  const trimmed = text.trim();

  if (trimmed === "") {
    throw new Error(`The key file ${source} is empty.`);
  }

  if (HEX.test(trimmed)) return Buffer.from(trimmed, "hex");

  let decoded: Buffer;
  try {
    decoded = Buffer.from(trimmed, "base64");
  } catch {
    throw new Error(
      `The key file ${source} is not 64 hex characters or base64 of 32 bytes.`,
    );
  }

  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `The key file ${source} holds ${decoded.length} bytes of key material; ` +
        `${KEY_BYTES} are required. Generate one with: npm run key:make`,
    );
  }

  return decoded;
}

export function keyProviderFrom(material: Buffer): KeyProvider {
  if (material.length !== KEY_BYTES) {
    throw new Error(
      `A key-encryption key must be ${KEY_BYTES} bytes, not ${material.length}.`,
    );
  }

  const id = createHash("sha256").update(material).digest().subarray(0, 4);

  return {
    kek: () => material,
    keyId: () => id,
  };
}

/**
 * Read the key at boot, not at first use.
 *
 * A missing key file has to stop the server by name. The alternative is a
 * server that starts, serves the vault list, and fails at the first upload —
 * which means discovering it while somebody is trying to file a passport.
 */
export function keyProviderFromFile(path: string): KeyProvider {
  let contents: string;

  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? "unreadable";
    throw new Error(
      `Cannot read the key file at ${path} (${reason}). ` +
        `Set SAFEHOUSE_KEY_FILE, or generate one with: npm run key:make`,
      { cause: error },
    );
  }

  return keyProviderFrom(parseKeyMaterial(contents, path));
}

let cached: KeyProvider | undefined;

/** The provider the application uses. Reads the file once. */
export function keys(): KeyProvider {
  cached ??= keyProviderFromFile(requireEnv("SAFEHOUSE_KEY_FILE"));
  return cached;
}
