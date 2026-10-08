/**
 * Identifiers at rest (D35).
 *
 * The property that matters is the one D14 used to give up: a copy of the
 * database holds no readable number. Then the ones that make that worth
 * having — a sealed value opens only in its own row and only under its own
 * key, and the fingerprints find a number without being the number.
 */

import { describe, expect, test } from "vitest";

import {
  fingerprints,
  normalizeIdentifier,
  openIdentifier,
  queryFingerprints,
  sealIdentifier,
} from "./field-crypto.server";
import { keyProviderFrom } from "./keys.server";

const KEY = keyProviderFrom(Buffer.alloc(32, 7));
const OTHER = keyProviderFrom(Buffer.alloc(32, 8));
const ROW = "00000000-0000-4000-8000-000000000301";
const ELSEWHERE = "00000000-0000-4000-8000-000000000302";

describe("sealing", () => {
  test("round-trips, and the sealed bytes do not contain the number", () => {
    const sealed = sealIdentifier("X1234567", ROW, KEY);

    expect(openIdentifier(sealed, ROW, KEY)).toBe("X1234567");
    expect(sealed.includes(Buffer.from("X1234567"))).toBe(false);
    expect(sealed.includes(Buffer.from("1234567"))).toBe(false);
  });

  test("the same number sealed twice looks different", () => {
    expect(sealIdentifier("X1234567", ROW, KEY).equals(sealIdentifier("X1234567", ROW, KEY))).toBe(false);
  });

  test("opens only in the row it was written for", () => {
    const sealed = sealIdentifier("X1234567", ROW, KEY);
    expect(() => openIdentifier(sealed, ELSEWHERE, KEY)).toThrow();
  });

  test("says so by name when it was sealed under another key", () => {
    const sealed = sealIdentifier("X1234567", ROW, OTHER);
    expect(() => openIdentifier(sealed, ROW, KEY)).toThrow(/different key-encryption key/);
  });

  test("refuses a tampered value", () => {
    const sealed = sealIdentifier("X1234567", ROW, KEY);
    sealed[sealed.length - 20] ^= 1;
    expect(() => openIdentifier(sealed, ROW, KEY)).toThrow();
  });

  test("keeps what was typed, spacing and all; only the fingerprint is normalized", () => {
    const sealed = sealIdentifier(" x12 345-678 ", ROW, KEY);
    expect(openIdentifier(sealed, ROW, KEY)).toBe("x12 345-678");
  });
});

describe("fingerprints", () => {
  test("the same number however it was typed", () => {
    expect(normalizeIdentifier(" x12 345-678 ")).toBe("X12345678");
    expect(fingerprints("x12 345-678", KEY)).toEqual(fingerprints("X12345678", KEY));
  });

  test("full-width digits are the same digits", () => {
    expect(normalizeIdentifier("Ｘ１２３４")).toBe("X1234");
  });

  test("are keyed: another key gives another fingerprint", () => {
    expect(fingerprints("X12345678", KEY).full.equals(fingerprints("X12345678", OTHER).full)).toBe(false);
  });

  test("the last four of one number match a search for those four", () => {
    const stored = fingerprints("X12345678", KEY);
    const query = queryFingerprints("5678", KEY)!;

    expect(query.last4?.equals(stored.last4)).toBe(true);
    expect(query.full.equals(stored.full)).toBe(false);
  });

  test("a four-character search is not also a whole-number search for a different field", () => {
    // Domain separated: a number that is exactly "5678" has a whole-number
    // fingerprint that is not its own last-four fingerprint.
    const stored = fingerprints("5678", KEY);
    expect(stored.full.equals(stored.last4)).toBe(false);
  });

  test("a search with nothing in it searches for nothing", () => {
    expect(queryFingerprints(" - ", KEY)).toBeNull();
  });

  test("only exactly four characters searches the last four", () => {
    expect(queryFingerprints("678", KEY)?.last4).toBeNull();
    expect(queryFingerprints("45678", KEY)?.last4).toBeNull();
  });
});
