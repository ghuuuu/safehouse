/**
 * What a policy pack gives up, and the one thing it must never give up.
 *
 * The assertion that matters most is in "the brochure": an insurance product
 * information document carries product ceilings, not this household's cover,
 * and taking a figure off one would produce a wrong number that looks exactly
 * like a right one. The page allowlist is what prevents it, and this is where
 * that is pinned.
 *
 * All data fictional (CLAUDE.md). The figures are shaped like the real ones
 * observed in the research — including a pack whose headline premium and
 * invoice total disagree, because that is the case a single answer gets wrong.
 */

import { describe, expect, test } from "vitest";

import type { TextLine } from "./ocr.server";
import {
  classify,
  findSignposts,
  proposeFields,
  quoteFacts,
  readTerms,
} from "./terms.server";

/** Lines are easier to write than PDFs, and this is what the reader hands over. */
function page(n: number, texts: string[]): TextLine[] {
  return texts.map((text, index) => ({
    page: n,
    y: 700 - index * 14,
    size: 11,
    runs: [{ x: 60, width: text.length * 5, str: text }],
    text,
  }));
}

/** A renewal pack: brochure, then schedule, then wording. One file. */
const PACK: TextLine[] = [
  ...page(1, [
    "Insurance Product Information Document",
    "Fictional Mutual Insurance plc",
    "What is this type of insurance?",
    "What is insured?",
    "Buildings sum insured: 1,000,000",
    "What is not insured?",
    "Are there any restrictions on cover?",
    "Where am I covered?",
    "Excess: see your personal details for the limits that apply",
  ]),
  ...page(2, [
    "Policy Schedule",
    "Policy Number: FX/ZZ/8891023",
    "Cover start date: 14/03/2026",
    "Cover end date: 14/03/2027",
    "Buildings sum insured: 450,000",
    "Compulsory excess: 250",
    "Premium: 612.40 including Insurance Premium Tax",
    "Administration fee: 50.00",
    "Total premium due: 662.40",
  ]),
  ...page(3, [
    "General exclusions",
    "We do not cover loss or damage arising from wear and tear, or from any",
    "gradual cause, however it arises, and this sentence is prose rather than a",
    "heading so it must not become a signpost of its own.",
    "Making a claim",
  ]),
];

describe("what each part of a pack is", () => {
  test("the brochure, the schedule and the wording are told apart", () => {
    const sections = classify(PACK);

    expect(sections.find((s) => s.type === "ipid")?.fromPage).toBe(1);
    expect(sections.find((s) => s.type === "schedule")?.fromPage).toBe(2);
  });

  test("a document with no schedule or certificate is all wording", () => {
    const sections = classify(page(1, ["Some letter", "Dear customer"]));

    expect(sections).toEqual([{ type: "wording", fromPage: 1, toPage: 1 }]);
  });

  test("a motor certificate is recognised by the six headings the law fixes", () => {
    const certificate = page(1, [
      "Certificate of Motor Insurance",
      "1. Description of vehicle: FIXTURE REG",
      "2. The Policyholder: Maya Adeyemi",
      "3. Effective date of the commencement of insurance: 01/04/2026",
      "4. Date of expiry of insurance: 01/04/2027",
      "5. Persons or classes of person entitled to drive",
    ]);

    expect(classify(certificate)[0].type).toBe("motor_certificate");
  });
});

describe("the brochure", () => {
  test("no figure is ever taken from it", () => {
    // The IPID says "1,000,000 buildings sum insured" — a product ceiling, not
    // this household's cover. It also says, in its own words, to look at the
    // personal details for the real limits. A number lifted from here is wrong
    // and indistinguishable from right.
    const extraction = readTerms(PACK);

    expect(extraction.facts.every((fact) => fact.page !== 1)).toBe(true);
    expect(extraction.proposals.every((p) => !p.note?.includes("page 1"))).toBe(true);
    expect(JSON.stringify(extraction.facts)).not.toContain("1,000,000");
  });

  test("its pages are not in the allowlist even when it carries a matching label", () => {
    const brochureOnly = page(1, [
      "Insurance Product Information Document",
      "What is this type of insurance?",
      "What is insured?",
      "What is not insured?",
      "Where am I covered?",
      "Buildings sum insured: 1,000,000",
      "Policy Number: NOT-A-REAL-POLICY",
    ]);

    const extraction = readTerms(brochureOnly);

    expect(extraction.facts).toEqual([]);
    expect(extraction.proposals).toEqual([]);
  });
});

describe("the schedule", () => {
  const allowed = new Set([2]);

  test("proposes the dates and the policy number, from the schedule only", () => {
    const proposals = proposeFields(PACK, allowed);
    const byField = Object.fromEntries(proposals.map((p) => [p.field, p]));

    expect(byField.issued_on.value).toBe("14/03/2026");
    expect(byField.expires_on.value).toBe("14/03/2027");
    expect(byField.identifier.value).toBe("FX/ZZ/8891023");
  });

  test("every proposal says where it came from, verbatim", () => {
    // The raw string is in the note on purpose: it is how somebody notices
    // that 03/04/2027 was read day-first when a US document turns up.
    const [first] = proposeFields(PACK, allowed);

    expect(first.note).toMatch(/on page 2/);
    expect(first.note).toMatch(/printed as/);
    expect(first.verified).toBe(false);
  });

  test("a policy number never arrives as a quoted fact", () => {
    // It is masked, and a copy of it in a quotation would hand it back
    // sideways, past the password check that guards the real one.
    const facts = quoteFacts(PACK, allowed);

    expect(JSON.stringify(facts)).not.toContain("FX/ZZ/8891023");
  });
});

describe("money", () => {
  test("every premium figure is quoted, and none is chosen", () => {
    // A real pack carried a headline premium, an invoice figure, the tax and a
    // fee, and the headline disagreed with the total by the fee. Showing one
    // number is an assertion; showing the insurer's own labels is a quotation.
    const facts = quoteFacts(PACK, new Set([2]));
    const money = facts.filter((f) => /premium|fee/i.test(f.label));

    expect(money.length).toBeGreaterThanOrEqual(3);
    expect(money.map((f) => f.value)).toContain("50.00");
    expect(money.map((f) => f.value)).toContain("662.40");
  });

  test("nothing is summed, normalised or reconciled", () => {
    const facts = quoteFacts(PACK, new Set([2]));

    // Values come back exactly as printed — no currency symbol invented, no
    // thousands separator removed, no total computed.
    expect(facts.find((f) => /compulsory excess/i.test(f.label))?.value).toBe("250");
    expect(facts.every((f) => typeof f.value === "string")).toBe(true);
  });
});

describe("signposts", () => {
  test("headings become jump points", () => {
    const signposts = findSignposts(PACK);
    const headings = signposts.map((s) => s.heading);

    expect(headings).toContain("General exclusions");
    expect(headings).toContain("Making a claim");
    expect(signposts.find((s) => s.heading === "General exclusions")?.page).toBe(3);
  });

  test("a sentence that merely mentions a heading word is not one", () => {
    // "Exclusions apply to…" is prose. Linking to it sends somebody to the
    // wrong paragraph, which is worse than not linking at all.
    const signposts = findSignposts(PACK);

    expect(
      signposts.every((s) => !s.heading.includes("gradual cause")),
    ).toBe(true);
    expect(signposts.every((s) => s.heading.length <= 70)).toBe(true);
  });

  test("the brochure's own headings are signposts, since those are navigation", () => {
    // Nothing is taken from the IPID as a *figure*, but it is still a document
    // somebody wants to jump around in.
    const headings = findSignposts(PACK).map((s) => s.heading);

    expect(headings).toContain("What is not insured?");
  });
});

describe("what it says it did", () => {
  test("it names what it recognised", () => {
    expect(readTerms(PACK).how).toMatch(/information document/);
    expect(readTerms(PACK).how).toMatch(/schedule/);
  });

  test("with nothing recognisable, it says it took nothing", () => {
    const extraction = readTerms(page(1, ["Dear customer", "Thank you for your letter"]));

    expect(extraction.how).toMatch(/nothing was taken/i);
    expect(extraction.proposals).toEqual([]);
  });

  test("empty input is not an error", () => {
    expect(readTerms([]).sections).toEqual([]);
  });
});
