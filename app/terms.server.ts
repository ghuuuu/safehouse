/**
 * Reading an insurance policy without pretending to understand it.
 *
 * The structural fact this is built on: **the policy booklet deliberately does
 * not contain the numbers.** Insurers write "the maximum we will pay is the
 * buildings sum insured as stated on your schedule" — the booklet carries the
 * conditions, and a one- or two-page schedule carries this household's actual
 * figures. Those are two different jobs, and conflating them is how this ships
 * broken.
 *
 * So, three things, in this order:
 *
 *   1. **Classify.** Consumer insurance is standardised by law. A motor
 *      certificate carries six numbered headings in a fixed order; an IPID
 *      carries nine headings in wording fixed by regulation since 2018. That
 *      makes recognising what a page is cheap and close to certain.
 *   2. **Match**, but only inside a schedule or a certificate. Never on the
 *      wording, and above all never on the IPID — which is a product brochure
 *      whose only numbers are product ceilings, and which says so itself
 *      ("see your personal details for the limits that apply"). Pulling a sum
 *      insured out of one produces a wrong number indistinguishable from a
 *      right one. The page allowlist makes that structurally impossible rather
 *      than merely discouraged.
 *   3. **Signpost.** A heading index. "General exclusions — page 15." That is
 *      what "help me find the conditions" actually means, and it is navigation
 *      rather than comprehension: the household still reads the clause, they
 *      just stop reading forty pages to find it.
 *
 * Nothing here parses money, sums anything, reconciles anything or decides
 * which of five premium figures is "the" premium. Quoting an insurer is a
 * quotation; printing one number is an assertion, and this module never
 * asserts. See D28 for why the fourth thing — answering "am I covered" — is
 * not here and is not coming.
 */

import type { TextLine } from "./ocr.server";
import type { Proposal } from "./ocr.server";

export type SectionType = "motor_certificate" | "schedule" | "ipid" | "wording";

export type Section = { type: SectionType; fromPage: number; toPage: number };

/** An insurer's own words and figure, quoted. Never parsed, never totalled. */
export type Fact = { label: string; value: string; page: number };

export type Signpost = { heading: string; page: number };

export type Extraction = {
  how: string;
  sections: Section[];
  proposals: Proposal[];
  facts: Fact[];
  signposts: Signpost[];
};

/* ------------------------------------------------------------------ */
/* Vocabularies — data, observed verbatim in real documents            */
/* ------------------------------------------------------------------ */

/**
 * Commission Implementing Regulation (EU) 2017/1469, retained in the UK as
 * FCA ICOBS 6 Annex 3R. Fixed wording, fixed order, on every consumer
 * general-insurance product sold in the UK and EEA since 1 October 2018.
 */
const IPID_HEADINGS = [
  /what is this type of insurance\?/i,
  /what is insured\?/i,
  /what is not insured\?/i,
  /are there any restrictions on cover\?/i,
  /where am i covered\?/i,
  /what are my obligations\?/i,
  /when and how do i pay\?/i,
  /when does the cover start and end\?/i,
  /how do i cancel the contract\?/i,
];

/** The six headings a motor certificate must carry, in order, by law. */
const MOTOR_CERTIFICATE_HEADINGS = [
  /^1\.?\s*description of vehicle/i,
  /^2\.?\s*(the )?policyholder/i,
  /^3\.?\s*effective date of the commencement/i,
  /^4\.?\s*date of expiry of insurance/i,
  /^5\.?\s*persons or classes of person entitled to drive/i,
  /^6\.?\s*limitations as to use/i,
];

const SCHEDULE_HEADINGS = [
  /^(policy\s+)?schedule\b/i,
  /^your\s+schedule\b/i,
  /^schedule of insurance\b/i,
  /^(policy\s+)?declarations\b/i,
];

/**
 * Labels whose value is a field on the document. Only ever matched inside a
 * schedule or certificate.
 */
const FIELD_LABELS: { field: string; labels: RegExp[] }[] = [
  {
    field: "expires_on",
    labels: [
      /^4\.?\s*date of expiry of insurance\b/i,
      /^(cover\s+)?end date\b/i,
      /^expiry date\b/i,
      /^date of expiry\b/i,
      /^policy exp\b/i,
    ],
  },
  {
    field: "issued_on",
    labels: [
      /^3\.?\s*effective date of the commencement\b/i,
      /^(cover\s+)?start date\b/i,
      /^inception date\b/i,
      /^effective date\b/i,
      /^policy eff\b/i,
    ],
  },
  {
    field: "identifier",
    labels: [
      /^(your\s+)?(policy|certificate|cover|contract)\s*(number|no\.?|ref(erence)?)\b/i,
    ],
  },
];

/**
 * Labels whose value is quoted and written nowhere.
 *
 * Deliberately disjoint from the field labels above: a policy number can never
 * arrive as a quoted fact, because the identifier is masked and a copy of it
 * sitting in a quotation would hand it back sideways.
 */
const FACT_LABELS: RegExp[] = [
  /^(buildings |contents |basic )?sum insured\b/i,
  /^limit of (indemnity|liability)\b/i,
  /^amount of insurance\b/i,
  /^(compulsory |voluntary )?excess(es)?\b/i,
  /^deductible\b/i,
  /^(total |annual )?premium( due)?\b/i,
  /^insurance premium tax\b/i,
  /^administration fee\b/i,
  /^(next )?renewal date\b/i,
  /^insurer\b/i,
  /^underwritten by\b/i,
  /^(policy)?holder( name)?\b/i,
  /^cover type\b/i,
  /^period of (insurance|cover)\b/i,
];

/** Headings worth being able to jump to, as insurers actually write them. */
const SIGNPOST_HEADINGS: RegExp[] = [
  ...IPID_HEADINGS,
  /^what is (not )?covered\b/i,
  /^what you are not covered for\b/i,
  /^loss or damage (that is )?(not )?covered\b/i,
  /^(general |policy )?exclusions?\b/i,
  /^(general |policy |claims )?(terms and )?conditions( of cover)?\b/i,
  /^excess(es)?\b/i,
  /^how to pay your excess\b/i,
  /^(how to )?mak(e|ing) a claim\b/i,
  /^claims (settlement|procedures?)\b/i,
  /^cancellation( by (you|us))?\b/i,
  /^cancelling this policy\b/i,
  /^your cancellation rights\b/i,
  /^cooling[- ]off( period)?\b/i,
  /^(policy )?definitions\b/i,
  /^words with special meanings\b/i,
  /^period of insurance\b/i,
  /^renewal of the policy\b/i,
];

/* ------------------------------------------------------------------ */
/* 1. Classify                                                         */
/* ------------------------------------------------------------------ */

/**
 * What each part of the file is.
 *
 * Returns a list rather than one answer, because one upload is usually several
 * documents: a real renewal pack runs covering letter, summary, invoice,
 * schedule, then the full wording, in one PDF of fifty-odd pages.
 */
export function classify(lines: TextLine[]): Section[] {
  const pages = [...new Set(lines.map((line) => line.page))].sort((a, b) => a - b);
  const found: { page: number; type: SectionType }[] = [];

  for (const page of pages) {
    const texts = lines.filter((line) => line.page === page).map((line) => line.text);
    const hits = (patterns: RegExp[]) =>
      patterns.filter((pattern) => texts.some((text) => pattern.test(text))).length;

    if (
      texts.some((text) => /insurance product information document/i.test(text)) &&
      hits(IPID_HEADINGS) >= 4
    ) {
      found.push({ page, type: "ipid" });
      continue;
    }

    if (hits(MOTOR_CERTIFICATE_HEADINGS) >= 4) {
      found.push({ page, type: "motor_certificate" });
      continue;
    }

    if (hits(SCHEDULE_HEADINGS) >= 1) {
      found.push({ page, type: "schedule" });
    }
  }

  if (found.length === 0) {
    return pages.length
      ? [{ type: "wording", fromPage: pages[0], toPage: pages[pages.length - 1] }]
      : [];
  }

  const last = pages[pages.length - 1];

  /**
   * The first page that reads like the booklet rather than the schedule.
   *
   * A schedule's range would otherwise run on into the policy wording, and the
   * wording is full of labels — it defines "excess" and discusses sums insured
   * generically. Matching a figure there is the same mistake as matching one on
   * the brochure, so the range stops where the conditions start.
   */
  const bookletStartsAt = (after: number): number => {
    for (const page of pages.filter((p) => p > after)) {
      const texts = lines.filter((line) => line.page === page).map((l) => l.text);
      if (texts.some((text) => text.length <= 70 && WORDING_HEADINGS.test(text))) {
        return page;
      }
    }
    return last + 1;
  };

  return found.map((start, index) => {
    const nextStart = found[index + 1]?.page ?? last + 1;
    // ponytail: a schedule runs to the next recognised section, capped at four
    // pages. Widen it if a real household schedule overruns.
    const cap = start.type === "schedule" ? 4 : 2;

    return {
      type: start.type,
      fromPage: start.page,
      toPage: Math.min(
        nextStart - 1,
        bookletStartsAt(start.page) - 1,
        start.page + cap - 1,
        last,
      ),
    };
  });
}

/** Headings that mean the conditions have started and the figures have stopped. */
const WORDING_HEADINGS =
  /^((general|policy) )?(exclusions?|conditions|definitions)\b|^what is (not )?covered\b|^words with special meanings\b/i;

/* ------------------------------------------------------------------ */
/* 2. Match, inside the allowlist only                                 */
/* ------------------------------------------------------------------ */

/** The value printed against a label: same line to the right, else below. */
function valueFor(line: TextLine, lines: TextLine[], label: RegExp): string | null {
  const match = label.exec(line.text);
  if (!match) return null;

  const rest = line.text.slice(match[0].length).replace(/^[\s:·—-]+/, "").trim();
  if (rest) return rest;

  // Nothing after the label on this line: take the line immediately below,
  // and only that one. Reaching further down finds the next field's value.
  const below = lines
    .filter((other) => other.page === line.page && other.y < line.y)
    .sort((a, b) => b.y - a.y)[0];

  const value = below?.text.trim();
  return value && value.length <= 120 ? (value ?? null) : null;
}

/**
 * Every match, with its page. Never the first.
 *
 * A label appearing twice in a pack produces two proposals and the person
 * picks between them. Choosing one silently is how a definition in the wording
 * beats the figure on the schedule.
 */
export function proposeFields(lines: TextLine[], allowed: Set<number>): Proposal[] {
  const proposals: Proposal[] = [];

  for (const line of lines) {
    if (!allowed.has(line.page)) continue;

    for (const { field, labels } of FIELD_LABELS) {
      for (const label of labels) {
        const value = valueFor(line, lines, label);
        if (!value) continue;

        const printed = label.exec(line.text)?.[0]?.trim() ?? "";

        proposals.push({
          field,
          value,
          source: "pdf-text",
          verified: false,
          // The label verbatim, the page, and the raw string — which is also
          // where a reader notices that 03/04/2027 was read day-first.
          note: `From "${printed}" on page ${line.page}, printed as "${value}".`,
        });
      }
    }
  }

  return proposals;
}

/* ------------------------------------------------------------------ */
/* 3. Quote, and signpost                                              */
/* ------------------------------------------------------------------ */

export function quoteFacts(lines: TextLine[], allowed: Set<number>): Fact[] {
  const facts: Fact[] = [];

  for (const line of lines) {
    if (!allowed.has(line.page)) continue;

    for (const label of FACT_LABELS) {
      const value = valueFor(line, lines, label);
      if (!value) continue;

      facts.push({
        label: label.exec(line.text)?.[0]?.trim() ?? "",
        value,
        page: line.page,
      });
    }
  }

  return facts;
}

export function findSignposts(lines: TextLine[]): Signpost[] {
  const seen = new Set<string>();
  const signposts: Signpost[] = [];

  for (const line of lines) {
    // A heading is short. A sentence that happens to begin "Exclusions apply
    // to…" is prose, and linking to it would send somebody to the wrong place.
    if (line.text.length > 70) continue;

    // "Excess: see your personal details for the limits that apply" is a
    // labelled value, not a heading. A colon followed by a sentence is the
    // tell.
    if (/:\s*\S.{20,}/.test(line.text)) continue;

    for (const pattern of SIGNPOST_HEADINGS) {
      if (!pattern.test(line.text)) continue;

      const key = `${line.text.toLowerCase()}|${line.page}`;
      if (seen.has(key)) break;

      seen.add(key);
      signposts.push({ heading: line.text, page: line.page });
      break;
    }
  }

  return signposts;
}

/* ------------------------------------------------------------------ */
/* The whole job                                                       */
/* ------------------------------------------------------------------ */

export function readTerms(lines: TextLine[]): Extraction {
  const sections = classify(lines);

  // The allowlist is the safety mechanism, and it is a list of pages rather
  // than a rule somebody has to remember: the IPID's pages are not in it, so
  // no amount of later editing can make a product ceiling look like this
  // household's cover.
  const allowed = new Set<number>();
  for (const section of sections) {
    if (section.type !== "schedule" && section.type !== "motor_certificate") continue;
    for (let page = section.fromPage; page <= section.toPage; page += 1) {
      allowed.add(page);
    }
  }

  const proposals = proposeFields(lines, allowed);
  const facts = quoteFacts(lines, allowed);
  const signposts = findSignposts(lines);

  const named = sections
    .filter((section) => section.type !== "wording")
    .map((section) => DESCRIPTIONS[section.type]);

  return {
    how: named.length
      ? `Recognised ${named.join(", ")}. Figures are quoted from the schedule, not from the booklet.`
      : "No part of this looked like a schedule or a certificate, so nothing was taken from it as a figure.",
    sections,
    proposals,
    facts,
    signposts,
  };
}

const DESCRIPTIONS: Record<SectionType, string> = {
  ipid: "an insurance product information document",
  motor_certificate: "a certificate of motor insurance",
  schedule: "a policy schedule",
  wording: "the policy wording",
};
