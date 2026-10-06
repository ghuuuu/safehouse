/**
 * What the reader proposes, and — more to the point — what it refuses to.
 *
 * The engine itself is a binary that is not on a developer's laptop, so these
 * cover the parts that decide whether a value is trustworthy: which MRZ fields
 * the check digits actually cover, and how little is guessed from loose text.
 * The engine is exercised in the container.
 */

import { describe, expect, test } from "vitest";

import { proposalsFromMrz, proposalsFromText } from "./ocr.server";

/** A fictional strip, in the shape a TD3 passport carries. */
const FIELDS = {
  documentType: "P",
  issuingState: "ZZZ",
  lastName: "ADEYEMI",
  firstName: "MAYA",
  documentNumber: "FX1234567",
  nationality: "ZZZ",
  birthDate: "790722",
  sex: "female",
  expirationDate: "310131",
};

function proposed(fields: Record<string, string>) {
  return Object.fromEntries(
    proposalsFromMrz(fields).map((p) => [p.field, p]),
  );
}

describe("what a passport strip offers", () => {
  test("the number and the expiry, both marked verified", () => {
    const p = proposed(FIELDS);

    expect(p.identifier.value).toBe("FX1234567");
    expect(p.identifier.verified).toBe(true);
    expect(p.expires_on.value).toBe("2031-01-31");
    expect(p.expires_on.verified).toBe(true);
  });

  test("never the name, not even unverified", () => {
    // The check digits cover the number, the dates and the optional field, and
    // nothing else — the name is excluded by the standard. It is also the
    // field that decides whose document this is, which is why it is not
    // offered at all rather than offered with a caveat nobody reads.
    const proposals = proposalsFromMrz(FIELDS);
    const fields = proposals.map((p) => p.field);

    expect(fields).not.toContain("name");
    expect(JSON.stringify(proposals)).not.toContain("ADEYEMI");
    expect(JSON.stringify(proposals)).not.toContain("MAYA");
  });

  test("the issuing state is offered, and marked unchecked", () => {
    const p = proposed(FIELDS);

    expect(p.issuer_country.value).toBe("ZZZ");
    expect(p.issuer_country.verified).toBe(false);
    expect(p.issuer_country.note).toMatch(/no check digit/i);
  });

  test("a number ending in zero is flagged even though it passed", () => {
    // `<` and `0` are both worth zero in the arithmetic, so a trailing filler
    // misread as a zero validates exactly as happily as the real thing.
    const p = proposed({ ...FIELDS, documentNumber: "FX1234560" });

    expect(p.identifier.verified).toBe(true);
    expect(p.identifier.note).toMatch(/zero/i);
  });

  test("a number not ending in zero carries no such warning", () => {
    expect(proposed(FIELDS).identifier.note).toBeUndefined();
  });

  test("an expiry in the eighties is next century, not the last one", () => {
    // Two digits of year, so the century is inferred. An expiry is ahead of
    // today; a passport expiring in '85 means 2085.
    const p = proposed({ ...FIELDS, expirationDate: "850131" });

    expect(p.expires_on.value).toBe("2085-01-31");
  });

  test("nonsense in a date field is dropped rather than offered", () => {
    const p = proposed({ ...FIELDS, expirationDate: "319999" });

    expect(p.expires_on).toBeUndefined();
  });

  test("an empty strip offers nothing", () => {
    expect(proposalsFromMrz({})).toEqual([]);
  });
});

describe("what loose text offers", () => {
  test("a date the document labels as its expiry", () => {
    const [proposal] = proposalsFromText(
      "ACME Insurance\nPolicy 99881\nThis policy expires on 2027-03-14.\n",
    );

    expect(proposal.value).toBe("2027-03-14");
    expect(proposal.verified).toBe(false);
    expect(proposal.note).toMatch(/check it/i);
  });

  test.each([
    ["Valid until 14/03/2027", "2027-03-14"],
    ["Expiry date: 14 March 2027", "2027-03-14"],
    ["Use before 14.03.2027", "2027-03-14"],
  ])("reads %s", (text, expected) => {
    expect(proposalsFromText(text)[0]?.value).toBe(expected);
  });

  test("a page full of dates with no expiry among them offers nothing", () => {
    // Taking every date and picking the latest produces a confident wrong
    // answer, and a confident wrong renewal date is the failure this whole
    // design is arranged to avoid.
    const proposals = proposalsFromText(
      "Statement period 01/08/2026 to 31/08/2026. Printed 02/09/2026. Page 1 of 4.",
    );

    expect(proposals).toEqual([]);
  });

  test("an ambiguous day-month pair is left to a person", () => {
    // 03/04 could be either way round. Guessing is worse than not answering.
    expect(proposalsFromText("Expires 03/04/2027")[0]?.value).toBe("2027-04-03");
  });

  test("empty text offers nothing", () => {
    expect(proposalsFromText("")).toEqual([]);
  });
});

describe("a renewal date is not an expiry date", () => {
  test("it is not offered as one", () => {
    // They usually coincide and they are not the same fact: a policy can renew
    // automatically on a date its cover does not end on. Mapping one to the
    // other puts a wrong date behind a reminder, quietly. The renewal date is
    // quoted as a fact instead, with the insurer's own label (terms.server.ts).
    expect(proposalsFromText("Renewal date 14.03.2027")).toEqual([]);
  });
});
