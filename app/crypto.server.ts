/**
 * Envelope encryption for document files (D5, D12).
 *
 * Every file gets its own randomly generated data key. The file is encrypted
 * under that key; the data key is encrypted under the one key-encryption key
 * from `keys.server.ts` and stored, wrapped, in the file's row. The KEK is in
 * neither place.
 *
 * The indirection is what makes rotation possible: re-wrapping every data key
 * is a pass over one column, and no document file is rewritten. A scheme that
 * encrypted files directly under the KEK would make rotation mean re-encrypting
 * the whole vault, which is the kind of operation nobody ever runs.
 *
 * Both encryptions take the file row's id as additional authenticated data, so
 * a ciphertext only opens in the row it was written for. Somebody who can write
 * to the storage volume cannot move file A's bytes onto file B's key and have
 * the result decrypt — GCM checks that before it returns any plaintext.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { keys, type KeyProvider } from "./keys.server";

const CIPHER = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;
const KEY_ID_BYTES = 4;

/**
 * Version 1 of the wrapped-key format. It is a byte rather than an assumption
 * because the first format decision is never the last one.
 *
 *   version(1) ‖ keyId(4) ‖ nonce(12) ‖ ciphertext(32) ‖ tag(16) = 65 bytes
 */
const VERSION = 1;
const WRAPPED_BYTES =
  1 + KEY_ID_BYTES + NONCE_BYTES + DEK_BYTES + TAG_BYTES;

/** Everything a `document_files` row needs, plus the bytes to put on disk. */
export type SealedFile = {
  /** What goes on disk: ciphertext ‖ tag. The tag travels with the bytes. */
  stored: Buffer;
  /** The file's GCM nonce, for `document_files.nonce`. */
  nonce: Buffer;
  /** The wrapped data key, for `document_files.wrapped_dek`. */
  wrappedDek: Buffer;
  /** Of the plaintext, so a restore can prove what came back (D6). */
  sha256: string;
  /** Of the plaintext, because that is the size a person is shown. */
  byteSize: number;
};

function aad(fileId: string): Buffer {
  return Buffer.from(fileId, "utf8");
}

function wrapDek(dek: Buffer, fileId: string, provider: KeyProvider): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(CIPHER, provider.kek(), nonce);
  cipher.setAAD(aad(fileId));

  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);

  return Buffer.concat([
    Buffer.from([VERSION]),
    provider.keyId(),
    nonce,
    wrapped,
    cipher.getAuthTag(),
  ]);
}

function unwrapDek(
  wrappedDek: Buffer,
  fileId: string,
  provider: KeyProvider,
): Buffer {
  if (wrappedDek.length !== WRAPPED_BYTES) {
    throw new Error(
      `Wrapped key is ${wrappedDek.length} bytes, expected ${WRAPPED_BYTES}.`,
    );
  }

  const version = wrappedDek[0];
  if (version !== VERSION) {
    throw new Error(`Unknown wrapped-key format version ${version}.`);
  }

  if (!keyIdOf(wrappedDek).equals(provider.keyId())) {
    // Said plainly rather than left to fail as a tag mismatch, because the two
    // have very different answers: this one means "rotation has not reached
    // this row yet", and a tag mismatch means the data is wrong.
    throw new Error(
      "This data key was wrapped with a different key-encryption key.",
    );
  }

  const nonce = wrappedDek.subarray(5, 5 + NONCE_BYTES);
  const body = wrappedDek.subarray(5 + NONCE_BYTES, WRAPPED_BYTES - TAG_BYTES);
  const tag = wrappedDek.subarray(WRAPPED_BYTES - TAG_BYTES);

  const decipher = createDecipheriv(CIPHER, provider.kek(), nonce);
  decipher.setAAD(aad(fileId));
  decipher.setAuthTag(tag);

  // `final()` is what verifies the tag. Returning `update()` output without it
  // would hand back unauthenticated plaintext, which is the classic way to use
  // GCM and get none of its guarantees.
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** Which key-encryption key a wrapped data key belongs to. Reveals nothing. */
export function keyIdOf(wrappedDek: Buffer): Buffer {
  return wrappedDek.subarray(1, 1 + KEY_ID_BYTES);
}

/**
 * Encrypt a file for one row.
 *
 * `fileId` is the `document_files.id` the result will be stored under, and it
 * is authenticated, so these bytes will not open anywhere else.
 */
export function sealFile(
  plaintext: Buffer,
  fileId: string,
  provider: KeyProvider = keys(),
): SealedFile {
  const dek = randomBytes(DEK_BYTES);
  const nonce = randomBytes(NONCE_BYTES);

  const cipher = createCipheriv(CIPHER, dek, nonce);
  cipher.setAAD(aad(fileId));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  return {
    stored: Buffer.concat([ciphertext, cipher.getAuthTag()]),
    nonce,
    wrappedDek: wrapDek(dek, fileId, provider),
    sha256: createHash("sha256").update(plaintext).digest("hex"),
    byteSize: plaintext.length,
  };
}

/**
 * Decrypt a file for one row. Throws on any tampering, and never returns a
 * partial or unverified read.
 */
export function openFile(
  sealed: { stored: Buffer; nonce: Buffer; wrappedDek: Buffer },
  fileId: string,
  provider: KeyProvider = keys(),
): Buffer {
  if (sealed.stored.length < TAG_BYTES) {
    throw new Error("Stored file is too short to hold an authentication tag.");
  }

  const dek = unwrapDek(sealed.wrappedDek, fileId, provider);

  const body = sealed.stored.subarray(0, sealed.stored.length - TAG_BYTES);
  const tag = sealed.stored.subarray(sealed.stored.length - TAG_BYTES);

  const decipher = createDecipheriv(CIPHER, dek, sealed.nonce);
  decipher.setAAD(aad(fileId));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Move one data key from one key-encryption key to another.
 *
 * The document file is not touched, read, or rewritten — that is the whole
 * point of the envelope. Safe to interrupt: a row already wrapped under `to`
 * carries `to`'s key id, so a resumed pass can tell what is left to do.
 */
export function rewrapDek(
  wrappedDek: Buffer,
  fileId: string,
  from: KeyProvider,
  to: KeyProvider,
): Buffer {
  return wrapDek(unwrapDek(wrappedDek, fileId, from), fileId, to);
}
