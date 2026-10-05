/**
 * What the disk is worth without the key, and what tampering with it achieves.
 *
 * Every test here is the negative one: the value of encryption at rest is
 * entirely in what fails. A round-trip test alone would pass against a module
 * that wrote plaintext.
 */

import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import { keyIdOf, openFile, rewrapDek, sealFile } from "./crypto.server";
import { keyProviderFrom } from "./keys.server";

const KEK = keyProviderFrom(Buffer.alloc(32, 1));
const OTHER_KEK = keyProviderFrom(Buffer.alloc(32, 2));

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_FILE_ID = "22222222-2222-4222-8222-222222222222";

/** Recognisable, and long enough that a cipher cannot accidentally match it. */
const PLAINTEXT = Buffer.from(
  "fictional passport scan ".repeat(64) + "FIXTURE-PP-0001",
  "utf8",
);

function tamper(bytes: Buffer, index: number): Buffer {
  const copy = Buffer.from(bytes);
  copy[index] ^= 0xff;
  return copy;
}

describe("the round trip", () => {
  test("a sealed file opens back to the same bytes", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);
    const opened = openFile(sealed, FILE_ID, KEK);

    expect(opened.equals(PLAINTEXT)).toBe(true);
  });

  test("it records the plaintext's size and digest, not the ciphertext's", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);

    expect(sealed.byteSize).toBe(PLAINTEXT.length);
    expect(sealed.stored.length).toBe(PLAINTEXT.length + 16);
    // The digest a restore drill compares against is of what went in (D6).
    expect(sealed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sealFile(PLAINTEXT, FILE_ID, KEK).sha256).toBe(sealed.sha256);
  });

  test("two seals of the same file share no nonce and no ciphertext", () => {
    const first = sealFile(PLAINTEXT, FILE_ID, KEK);
    const second = sealFile(PLAINTEXT, FILE_ID, KEK);

    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.stored.equals(second.stored)).toBe(false);
    expect(first.wrappedDek.equals(second.wrappedDek)).toBe(false);
  });
});

describe("what the disk holds", () => {
  test("the stored bytes are not the plaintext and do not contain it", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);

    expect(sealed.stored.equals(PLAINTEXT)).toBe(false);
    expect(sealed.stored.includes(PLAINTEXT.subarray(0, 24))).toBe(false);
    // The identifier in the fixture text is the thing a grep over the volume
    // would be looking for.
    expect(sealed.stored.includes(Buffer.from("FIXTURE-PP-0001"))).toBe(false);
  });

  test("the wrapped key does not contain the data key or the KEK", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);

    expect(sealed.wrappedDek.includes(KEK.kek())).toBe(false);
    expect(sealed.wrappedDek).toHaveLength(65);
    expect(keyIdOf(sealed.wrappedDek).equals(KEK.keyId())).toBe(true);
  });
});

describe("tampering", () => {
  test("a flipped byte of ciphertext fails to open", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);
    const broken = { ...sealed, stored: tamper(sealed.stored, 0) };

    expect(() => openFile(broken, FILE_ID, KEK)).toThrow();
  });

  test("a flipped byte of the authentication tag fails to open", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);
    const broken = {
      ...sealed,
      stored: tamper(sealed.stored, sealed.stored.length - 1),
    };

    expect(() => openFile(broken, FILE_ID, KEK)).toThrow();
  });

  test("a flipped byte of the wrapped key fails to open", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);
    const broken = { ...sealed, wrappedDek: tamper(sealed.wrappedDek, 40) };

    expect(() => openFile(broken, FILE_ID, KEK)).toThrow();
  });

  test("a truncated file fails to open rather than returning what is left", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);
    const broken = { ...sealed, stored: sealed.stored.subarray(0, 8) };

    expect(() => openFile(broken, FILE_ID, KEK)).toThrow();
  });

  test("a wrapped key of the wrong length is refused before anything else", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);
    const broken = { ...sealed, wrappedDek: sealed.wrappedDek.subarray(0, 40) };

    expect(() => openFile(broken, FILE_ID, KEK)).toThrow(/65/);
  });
});

describe("the bindings", () => {
  test("a file does not open under another row's id", () => {
    // Somebody who can write to the storage volume must not be able to move
    // one document's bytes onto another document's row and have it open.
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);

    expect(() => openFile(sealed, OTHER_FILE_ID, KEK)).toThrow();
  });

  test("a file does not open under a different key-encryption key", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);

    expect(() => openFile(sealed, FILE_ID, OTHER_KEK)).toThrow(
      /different key-encryption key/,
    );
  });

  test("mixing one file's stored bytes with another's wrapped key fails", () => {
    const a = sealFile(PLAINTEXT, FILE_ID, KEK);
    const b = sealFile(PLAINTEXT, FILE_ID, KEK);

    expect(() =>
      openFile({ ...a, wrappedDek: b.wrappedDek }, FILE_ID, KEK),
    ).toThrow();
  });
});

describe("rotation", () => {
  test("re-wrapping changes the key without touching the file", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);
    const stored = Buffer.from(sealed.stored);

    const rewrapped = rewrapDek(sealed.wrappedDek, FILE_ID, KEK, OTHER_KEK);
    const after = { ...sealed, wrappedDek: rewrapped, stored };

    // The document file is byte-identical: rotation is a pass over one column.
    expect(after.stored.equals(sealed.stored)).toBe(true);
    expect(openFile(after, FILE_ID, OTHER_KEK).equals(PLAINTEXT)).toBe(true);
    expect(keyIdOf(rewrapped).equals(OTHER_KEK.keyId())).toBe(true);
  });

  test("the old key no longer opens a re-wrapped row", () => {
    const sealed = sealFile(PLAINTEXT, FILE_ID, KEK);
    const rewrapped = rewrapDek(sealed.wrappedDek, FILE_ID, KEK, OTHER_KEK);

    expect(() =>
      openFile({ ...sealed, wrappedDek: rewrapped }, FILE_ID, KEK),
    ).toThrow(/different key-encryption key/);
  });

  test("an interrupted rotation is readable: the key id says which rows are done", () => {
    // A half-finished pass leaves rows under two keys. Without the id there is
    // no way to tell them apart except by trying, which is how a vault loses
    // files.
    const done = rewrapDek(
      sealFile(PLAINTEXT, FILE_ID, KEK).wrappedDek,
      FILE_ID,
      KEK,
      OTHER_KEK,
    );
    const notYet = sealFile(PLAINTEXT, OTHER_FILE_ID, KEK).wrappedDek;

    expect(keyIdOf(done).equals(OTHER_KEK.keyId())).toBe(true);
    expect(keyIdOf(notYet).equals(KEK.keyId())).toBe(true);
  });
});

describe("sizes", () => {
  test("an empty file seals and opens", () => {
    const sealed = sealFile(Buffer.alloc(0), FILE_ID, KEK);

    expect(sealed.byteSize).toBe(0);
    expect(openFile(sealed, FILE_ID, KEK)).toHaveLength(0);
  });

  test("a few megabytes of random bytes round-trip", () => {
    const big = randomBytes(4 * 1024 * 1024);
    const sealed = sealFile(big, FILE_ID, KEK);

    expect(openFile(sealed, FILE_ID, KEK).equals(big)).toBe(true);
  });
});
