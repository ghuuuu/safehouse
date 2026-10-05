/**
 * The key-encryption key, and the ways a person can get it wrong.
 *
 * Every refusal here is a boot-time refusal. The failure this file exists to
 * prevent is a server that starts with half a key and discovers it at the
 * first upload.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  keyProviderFrom,
  keyProviderFromFile,
  parseKeyMaterial,
} from "./keys.server";

const MATERIAL = Buffer.alloc(32, 7);
const HEX = MATERIAL.toString("hex");

async function keyFile(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "safehouse-key-"));
  const path = join(dir, "safehouse.key");
  await writeFile(path, contents);
  return path;
}

describe("reading key material", () => {
  test("accepts 64 hex characters", () => {
    expect(parseKeyMaterial(HEX, "test").equals(MATERIAL)).toBe(true);
  });

  test("accepts base64, so a printed key can be typed back in", () => {
    const base64 = MATERIAL.toString("base64");
    expect(parseKeyMaterial(base64, "test").equals(MATERIAL)).toBe(true);
  });

  test("ignores the newline every editor adds", () => {
    expect(parseKeyMaterial(`${HEX}\n`, "test").equals(MATERIAL)).toBe(true);
  });

  test("refuses an empty file", () => {
    expect(() => parseKeyMaterial("   \n", "test")).toThrow(/empty/i);
  });

  test("refuses key material of the wrong length", () => {
    // Half a key is the dangerous case: it looks like a key, and base64 will
    // decode it without complaining.
    const half = Buffer.alloc(16, 7).toString("base64");
    expect(() => parseKeyMaterial(half, "test")).toThrow(/16 bytes/);
  });

  test("refuses something that is not key material at all", () => {
    expect(() => parseKeyMaterial("the key is in the drawer", "test")).toThrow();
  });

  test("never puts the key in its own error message", () => {
    // An error that quotes what it rejected writes the key to a log the first
    // time somebody pastes it with a stray character on the end.
    const nearly = `${HEX}X`;
    try {
      parseKeyMaterial(nearly, "/run/secrets/safehouse_key");
      throw new Error("should have refused");
    } catch (error) {
      expect(String(error)).not.toContain(HEX.slice(0, 16));
    }
  });
});

describe("identifying a key without revealing it", () => {
  test("the id is four bytes and is not the key", () => {
    const id = keyProviderFrom(MATERIAL).keyId();

    expect(id).toHaveLength(4);
    expect(MATERIAL.includes(id)).toBe(false);
  });

  test("the same key always has the same id", () => {
    const a = keyProviderFrom(Buffer.from(MATERIAL)).keyId();
    const b = keyProviderFrom(Buffer.from(MATERIAL)).keyId();

    expect(a.equals(b)).toBe(true);
  });

  test("a different key has a different id", () => {
    const other = keyProviderFrom(randomBytes(32)).keyId();

    expect(other.equals(keyProviderFrom(MATERIAL).keyId())).toBe(false);
  });

  test("refuses to build a provider from the wrong number of bytes", () => {
    expect(() => keyProviderFrom(Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe("reading the key file", () => {
  test("reads a key written as hex", async () => {
    const provider = keyProviderFromFile(await keyFile(HEX));
    expect(provider.kek().equals(MATERIAL)).toBe(true);
  });

  test("a missing key file names itself and the way out", async () => {
    const missing = join(tmpdir(), "safehouse-no-such-key-file");

    expect(() => keyProviderFromFile(missing)).toThrow(/SAFEHOUSE_KEY_FILE/);
    expect(() => keyProviderFromFile(missing)).toThrow(/key:make/);
  });
});
