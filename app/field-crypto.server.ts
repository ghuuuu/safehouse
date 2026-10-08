/**
 * Identifiers at rest: sealed, and findable by fingerprint (D35, replacing D14).
 *
 * A passport number is stored three ways and readable in none of them:
 *
 *   identifier_sealed     AES-256-GCM, opened only by an explicit reveal.
 *   identifier_fp         HMAC-SHA256 of the whole normalized number.
 *   identifier_last4_fp   HMAC-SHA256 of its last four characters.
 *
 * Search compares fingerprints, so the database answers "is this the number?"
 * without ever holding it. That is the trade D35 records: whole-number and
 * last-four search survive, finding a number by a fragment from its middle
 * does not.
 *
 * Both keys are derived from the KEK with HKDF under different labels, so the
 * key that seals is never the key that fingerprints, and neither is the key
 * that wraps document keys. Same primitives as `crypto.server.ts`, all from
 * node:crypto. Nothing is written here that the standard library does not do.
 *
 * Sealed format, version 1:
 *
 *   version(1) ‖ keyId(4) ‖ nonce(12) ‖ ciphertext(n) ‖ tag(16)
 *
 * The document id is the additional authenticated data, so a value copied
 * into another row will not open there.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

import { keys, type KeyProvider } from "./keys.server";

const CIPHER = "aes-256-gcm";
const VERSION = 1;
const KEY_ID_BYTES = 4;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + KEY_ID_BYTES + NONCE_BYTES;

const SEAL_LABEL = "safehouse/identifier-seal/v1";
const FINGERPRINT_LABEL = "safehouse/identifier-fingerprint/v1";

const derived = new WeakMap<KeyProvider, { seal: Buffer; fingerprint: Buffer }>();

function subkeys(provider: KeyProvider) {
  let found = derived.get(provider);
  if (!found) {
    const derive = (label: string) =>
      Buffer.from(hkdfSync("sha256", provider.kek(), Buffer.alloc(0), label, 32));
    found = { seal: derive(SEAL_LABEL), fingerprint: derive(FINGERPRINT_LABEL) };
    derived.set(provider, found);
  }
  return found;
}

/** "x12 345-678" and "X12345678" are the same number. */
export function normalizeIdentifier(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function sealIdentifier(value: string, documentId: string, provider: KeyProvider = keys()): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(CIPHER, subkeys(provider).seal, nonce);
  cipher.setAAD(Buffer.from(documentId, "utf8"));

  const body = Buffer.concat([cipher.update(value.trim(), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), provider.keyId(), nonce, body, cipher.getAuthTag()]);
}

export function openIdentifier(sealed: Buffer, documentId: string, provider: KeyProvider = keys()): string {
  if (sealed.length < HEADER_BYTES + TAG_BYTES || sealed[0] !== VERSION) {
    throw new Error("This is not a sealed identifier this version can read.");
  }
  if (!sealed.subarray(1, 1 + KEY_ID_BYTES).equals(provider.keyId())) {
    throw new Error("This identifier was sealed with a different key-encryption key.");
  }

  const nonce = sealed.subarray(1 + KEY_ID_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv(CIPHER, subkeys(provider).seal, nonce);
  decipher.setAAD(Buffer.from(documentId, "utf8"));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));

  // `final()` checks the tag; nothing is returned before it has.
  return Buffer.concat([
    decipher.update(sealed.subarray(HEADER_BYTES, sealed.length - TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}

/** Labelled, so a whole number that happens to be four long is not its own last four. */
function hmac(provider: KeyProvider, kind: "full" | "last4", normalized: string): Buffer {
  return createHmac("sha256", subkeys(provider).fingerprint).update(`${kind}:${normalized}`).digest();
}

/** What is stored beside a sealed value. */
export function fingerprints(value: string, provider: KeyProvider = keys()) {
  const normalized = normalizeIdentifier(value);
  return {
    full: hmac(provider, "full", normalized),
    last4: hmac(provider, "last4", normalized.slice(-4)),
  };
}

/**
 * What a search compares. Exactly four characters also searches the last four;
 * anything else is a whole number or nothing.
 */
export function queryFingerprints(query: string, provider: KeyProvider = keys()) {
  const normalized = normalizeIdentifier(query);
  if (normalized === "") return null;

  return {
    full: hmac(provider, "full", normalized),
    last4: normalized.length === 4 ? hmac(provider, "last4", normalized) : null,
  };
}

/** The three columns, ready to write. Null clears all three. */
export function identifierColumns(value: string | null, documentId: string, provider: KeyProvider = keys()) {
  if (value === null || value.trim() === "") return { sealed: null, fp: null, last4: null };
  const { full, last4 } = fingerprints(value, provider);
  return { sealed: sealIdentifier(value, documentId, provider), fp: full, last4 };
}
