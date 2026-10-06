/**
 * Reading what a document says, on this machine (D26, D27).
 *
 * Three paths, tried in this order, because the first one is free and perfect
 * and the others are neither:
 *
 *   1. The PDF text layer. Bills, policies, tax returns and schedules are
 *      generated digitally and already carry their text, exactly. No OCR runs.
 *   2. The machine-readable strip, for passports and ID cards. Read with an
 *      OCR-B model, then verified by the check digits in ICAO 9303 — which is
 *      what makes this the one case where a machine's answer can be trusted
 *      without a person squinting at it.
 *   3. A whole-page read, for everything else. Mediocre, and that is accepted,
 *      because nothing here writes a field. Every value is a proposal.
 *
 * Nothing in this module reaches the network. That is not a policy, it is a
 * property: the engine is a local binary, the models are in the image, and the
 * only input is bytes already in the vault.
 *
 * Nothing here logs a document's text, a field value or a file name (CLAUDE.md).
 * Errors say which stage failed and how long the input was, never what it said.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** One pathological scan must not wedge the container. */
const TIMEOUT_MS = 60_000;

/** Beyond this, a page is a photograph of a wall, and the 2 GB outlier is real. */
const MAX_PIXELS = 40_000_000;

/** Where the vendored OCR-B model lives in the image. */
const EXTRA_TESSDATA =
  process.env.SAFEHOUSE_TESSDATA_DIR ?? "/usr/share/safehouse-tessdata";

export type Proposal = {
  field: string;
  value: string;
  /** How the value was arrived at, which decides how loudly to doubt it. */
  source: "pdf-text" | "mrz" | "page-text";
  /**
   * True only when something checked the value rather than merely reading it.
   * Today that means an ICAO check digit agreed.
   */
  verified: boolean;
  /** Said plainly on screen when it is not obvious. */
  note?: string;
};

export type ReadResult = {
  /** Everything the reader believes, for a person to confirm or correct. */
  proposals: Proposal[];
  /** The whole text, for search. Empty when nothing could be read. */
  text: string;
  /** Which path produced it, and why the others did not run. */
  how: string;
};

/* ------------------------------------------------------------------ */
/* 1. The free path                                                    */
/* ------------------------------------------------------------------ */

/**
 * The text a PDF already contains.
 *
 * Returns empty for a PDF that is a photograph in a wrapper, which is the
 * signal to fall through to OCR.
 */
export async function readPdfText(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });

  // `mergePages` makes this a string, but the type is a union over both shapes.
  return (Array.isArray(text) ? text.join("\n") : text).trim();
}

/* ------------------------------------------------------------------ */
/* 2. The strip                                                        */
/* ------------------------------------------------------------------ */

/** The 37 characters a machine-readable zone may contain, and nothing else. */
const MRZ_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

/**
 * Pull the machine-readable zone out of an identity document.
 *
 * The strip lives in the bottom band of the page, so that band is cropped,
 * flattened to grey and scaled up before reading. Several crops are tried,
 * cheapest first, and the first one whose check digits agree wins — brute force
 * is legitimate here precisely because the document can verify itself.
 */
export async function readMrz(
  image: Buffer,
): Promise<{ fields: Record<string, string>; valid: boolean } | null> {
  const sharp = (await import("sharp")).default;
  const { parse } = await import("mrz");

  const meta = await sharp(image).metadata();
  if (!meta.height || !meta.width) return null;

  // The strip sits in the bottom quarter to third of the page. Both are tried
  // because passports and ID cards place it differently.
  const bands = [0.25, 0.33, 0.2];

  for (const band of bands) {
    const top = Math.floor(meta.height * (1 - band));
    const crop = await sharp(image)
      .extract({ left: 0, top, width: meta.width, height: meta.height - top })
      .greyscale()
      .normalise()
      // OCR-B needs height to read well; 3x is enough and keeps it quick.
      .resize({ width: Math.min(meta.width * 3, 4000) })
      .png()
      .toBuffer();

    const text = await tesseract(crop, {
      model: "mrz",
      psm: "6",
      whitelist: MRZ_ALPHABET,
    }).catch(() => "");

    const lines = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, "").toUpperCase())
      .filter((line) => line.length >= 28 && /^[A-Z0-9<]+$/.test(line));

    if (lines.length < 2) continue;

    // The parser wants exactly the strip, so take the last two or three lines
    // of the right shape — anything above them is the printed page.
    for (const count of [2, 3]) {
      const candidate = lines.slice(-count);
      if (candidate.length !== count) continue;

      try {
        const result = parse(candidate);
        if (result.valid) {
          return { fields: flatten(result.fields), valid: true };
        }
      } catch {
        // Not a strip, or not one of the three formats. Try the next crop.
      }
    }
  }

  return null;
}

function flatten(fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => typeof value === "string" && value !== "")
      .map(([key, value]) => [key, value as string]),
  );
}

/* ------------------------------------------------------------------ */
/* 3. The page                                                         */
/* ------------------------------------------------------------------ */

export async function readPageText(image: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;

  const meta = await sharp(image).metadata();
  const pixels = (meta.width ?? 0) * (meta.height ?? 0);

  // Capping the input is what keeps the occasional enormous photograph from
  // taking the container's memory with it.
  const prepared =
    pixels > MAX_PIXELS
      ? await sharp(image).resize({ width: 4000, withoutEnlargement: true }).png().toBuffer()
      : await sharp(image).greyscale().png().toBuffer();

  return (await tesseract(prepared, { psm: "3" })).trim();
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

/**
 * One call to the binary, on a temporary file, with a hard timeout.
 *
 * No wrapper package: every one of them is abandoned, and this is shorter than
 * their documentation. `OMP_THREAD_LIMIT=1` keeps one page from taking every
 * core on a machine that is also serving the vault.
 */
async function tesseract(
  image: Buffer,
  options: { model?: string; psm: string; whitelist?: string },
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "safehouse-ocr-"));
  const input = join(dir, "page.png");

  try {
    await writeFile(input, image);

    const args = [input, "stdout", "--psm", options.psm, "--oem", "1"];

    if (options.model) {
      args.push("--tessdata-dir", EXTRA_TESSDATA, "-l", options.model);
    } else {
      args.push("-l", "eng");
    }

    if (options.whitelist) {
      args.push("-c", `tessedit_char_whitelist=${options.whitelist}`);
    }

    const { stdout } = await run("tesseract", args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    });

    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whether the engine is installed at all. False on a developer's laptop. */
export async function readerAvailable(): Promise<boolean> {
  try {
    await run("tesseract", ["--version"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the passport model is present.
 *
 * Checked rather than assumed, because its absence must not become a silent
 * fallback to the English model: that one gets 45% of MRZ characters wrong and
 * would propose a confident, wrong passport number (D27).
 */
export async function mrzModelAvailable(): Promise<boolean> {
  const { access } = await import("node:fs/promises");

  try {
    await access(join(EXTRA_TESSDATA, "mrz.traineddata"));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Turning a read into proposals                                       */
/* ------------------------------------------------------------------ */

/**
 * What the strip says, as fields on the document.
 *
 * Only what the check digits actually cover is offered as verified. ICAO 9303
 * computes digits over the document number, the date of birth, the expiry date
 * and the optional data — and over nothing else. The name, the nationality, the
 * issuing state and the document type are excluded from the composite digit by
 * the standard, so a misread there validates exactly as happily as a correct
 * one. The field that decides whose document this is, is the field with no way
 * to check itself, and it is never filled in silently.
 */
export function proposalsFromMrz(fields: Record<string, string>): Proposal[] {
  const proposals: Proposal[] = [];

  if (fields.documentNumber) {
    proposals.push({
      field: "identifier",
      value: fields.documentNumber,
      source: "mrz",
      verified: true,
      // `<` and `0` are both worth zero in the check-digit arithmetic, so a
      // trailing filler misread as a zero passes every test there is.
      note: fields.documentNumber.endsWith("0")
        ? "Ends in a zero, which the check digit cannot tell from a blank. Worth a look."
        : undefined,
    });
  }

  if (fields.expirationDate) {
    const date = fromMrzDate(fields.expirationDate, "future");
    if (date) {
      proposals.push({
        field: "expires_on",
        value: date,
        source: "mrz",
        verified: true,
      });
    }
  }

  if (fields.issuingState) {
    proposals.push({
      field: "issuer_country",
      value: fields.issuingState,
      source: "mrz",
      // Not covered by any check digit.
      verified: false,
      note: "No check digit covers the issuing state.",
    });
  }

  return proposals;
}

/**
 * MRZ dates are two digits of year, so a century has to be guessed. An expiry
 * is in the future and a birth date is in the past, which settles it for the
 * only two dates that appear.
 */
function fromMrzDate(value: string, lean: "future" | "past"): string | null {
  if (!/^\d{6}$/.test(value)) return null;

  const year = Number(value.slice(0, 2));
  const month = value.slice(2, 4);
  const day = value.slice(4, 6);
  const current = new Date().getFullYear() % 100;

  const century =
    lean === "future"
      ? year < current - 10
        ? 2100
        : 2000
      : year > current
        ? 1900
        : 2000;

  const iso = `${century + year}-${month}-${day}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Dates a document labels as its own expiry, and nothing else. */
const EXPIRY_LABEL =
  /(?:expir\w*|valid\s+(?:un)?til|renewal\s+date|use\s+before)\D{0,20}?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i;

/**
 * What can be guessed from loose text, which is very little on purpose.
 *
 * Only a date the document itself labels as an expiry is offered. Pulling every
 * date off a page and picking the latest produces a confident wrong answer, and
 * a confident wrong renewal date is the failure this whole design is arranged
 * to avoid.
 */
export function proposalsFromText(text: string): Proposal[] {
  const match = EXPIRY_LABEL.exec(text);
  if (!match) return [];

  const date = normaliseDate(match[1]);
  if (!date) return [];

  return [
    {
      field: "expires_on",
      value: date,
      source: "page-text",
      verified: false,
      note: "Found next to the word 'expires'. Check it against the document.",
    },
  ];
}

function normaliseDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return raw;

  const named = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(raw);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    return `${named[3]}-${pad(month)}-${pad(Number(named[1]))}`;
  }

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(raw);
  if (numeric) {
    const [, first, second, year] = numeric;
    // Day-first, because this household is not American and the ambiguous
    // cases are better left to a person than guessed at.
    if (Number(first) > 12) {
      return `${fullYear(year)}-${pad(Number(second))}-${pad(Number(first))}`;
    }
    if (Number(second) > 12) return null;
    return `${fullYear(year)}-${pad(Number(second))}-${pad(Number(first))}`;
  }

  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const fullYear = (y: string) => (y.length === 4 ? y : `20${y}`);

/* ------------------------------------------------------------------ */
/* The whole job                                                       */
/* ------------------------------------------------------------------ */

/**
 * Read one document, cheapest path first.
 *
 * Never throws for a document it cannot read: an unreadable scan is an ordinary
 * outcome, and the screen says so rather than showing an error.
 */
export async function readDocument(
  bytes: Buffer,
  mime: string,
): Promise<ReadResult> {
  if (mime === "application/pdf") {
    const text = await readPdfText(bytes).catch(() => "");

    if (text.length > 40) {
      return {
        proposals: proposalsFromText(text),
        text,
        how: "Read from the PDF's own text. Nothing was scanned or guessed.",
      };
    }

    return {
      proposals: [],
      text: "",
      how: "This PDF holds no text of its own — it is a picture of a document. Reading pictures inside PDFs is not built yet.",
    };
  }

  if (!(await readerAvailable())) {
    return {
      proposals: [],
      text: "",
      how: "The reader is not installed in this environment.",
    };
  }

  const hasMrzModel = await mrzModelAvailable();
  const mrz = hasMrzModel ? await readMrz(bytes).catch(() => null) : null;

  if (mrz?.valid) {
    return {
      proposals: proposalsFromMrz(mrz.fields),
      text: "",
      how: "Read from the machine-readable strip, and the check digits agree.",
    };
  }

  const text = await readPageText(bytes).catch(() => "");

  return {
    proposals: proposalsFromText(text),
    text,
    how:
      (hasMrzModel
        ? ""
        : "The passport model is not installed, so no identity document can be read here — see tessdata/README.md. ") +
      (text
        ? "Read from the page. Nothing here is checked — confirm anything it filled in."
        : "Nothing could be read from this page."),
  };
}
