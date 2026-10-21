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
  /** Present when the document was recognised as terms-bearing paperwork. */
  terms?: import("./terms.server").Extraction;
};

/* ------------------------------------------------------------------ */
/* 1. The free path                                                    */
/* ------------------------------------------------------------------ */

/** One line of a PDF, with enough geometry to tell a heading from a value. */
export type TextLine = {
  /** 1-based, because a person reading a page number counts from one. */
  page: number;
  y: number;
  /** The largest font on the line, which is most of what makes a heading. */
  size: number;
  runs: { x: number; width: number; str: string }[];
  text: string;
};

type Item = {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
};

/**
 * The text a PDF already contains, in both shapes it is needed in.
 *
 * `pages` is what gets stored and searched; `lines` is what gets reasoned
 * about. The division is the design rather than an accident: geometry is good
 * at deciding whether a line is a heading and which run holds a label's value,
 * and worse than unpdf's own extraction at producing readable prose — a
 * hand-rolled row reassembly interleaves the columns of a two-column policy.
 *
 * Both come off one document proxy. pdf.js transfers its input buffer to its
 * worker, so opening the same bytes twice throws.
 *
 * Empty for a PDF that is a photograph in a wrapper, which is the signal to
 * fall through to OCR.
 */
export async function readPdf(
  bytes: Buffer,
): Promise<{ pages: string[]; lines: TextLine[] }> {
  const { extractText, extractTextItems, getDocumentProxy } = await import("unpdf");

  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const { items } = await extractTextItems(pdf);

  return {
    pages: Array.isArray(text) ? text : [text],
    lines: buildLines(items as Item[][]),
  };
}

/**
 * Items into lines.
 *
 * A PDF has no concept of a line — it has runs of glyphs at coordinates — so
 * one is reconstructed by grouping runs that share a baseline. The origin is
 * the bottom-left corner, which is why lines sort by descending y.
 *
 * ponytail: 1.5pt absolute tolerance for "same baseline". Derive it from item
 * height if a document with mixed leading on one line ever turns up.
 */
export function buildLines(pages: Item[][]): TextLine[] {
  const lines: TextLine[] = [];

  pages.forEach((items, index) => {
    const buckets: { y: number; items: Item[] }[] = [];

    for (const item of items) {
      if (!item.str.trim()) continue;

      const bucket = buckets.find((b) => Math.abs(b.y - item.y) <= 1.5);
      if (bucket) bucket.items.push(item);
      else buckets.push({ y: item.y, items: [item] });
    }

    for (const bucket of buckets.sort((a, b) => b.y - a.y)) {
      const runs = bucket.items
        .sort((a, b) => a.x - b.x)
        .map((item) => ({ x: item.x, width: item.width, str: item.str }));

      lines.push({
        page: index + 1,
        y: bucket.y,
        size: Math.max(...bucket.items.map((i) => i.fontSize ?? 0)),
        runs,
        text: runs
          .map((run) => run.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      });
    }
  });

  return lines;
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

  // `metadata()` reports the stored pixels and ignores any `autoOrient()` later
  // in a pipeline, so a phone photo tagged sideways needs its dimensions
  // swapped here. Without this the band below is cropped off the wrong edge of
  // the displayed page — a vertical strip of margin — and no strip is ever
  // found. It fails silently, with no error and no log, which is how it went
  // unnoticed.
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;

  // The strip sits in the bottom quarter to third of the page. Both are tried
  // because passports and ID cards place it differently.
  const bands = [0.25, 0.33, 0.2];

  for (const band of bands) {
    const top = Math.floor(height * (1 - band));
    const crop = await sharp(image)
      // Before extract, always. The other order crops the wrong edge and
      // reports success.
      .autoOrient()
      .extract({ left: 0, top, width, height: height - top })
      .greyscale()
      .normalise()
      // OCR-B needs height to read well; 3x is enough and keeps it quick.
      .resize({ width: Math.min(width * 3, 4000) })
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

/**
 * `--psm 1` rather than 3: automatic page segmentation *with* orientation and
 * script detection, so Tesseract notices a page that is a quarter turn out and
 * rotates it internally before recognising. The model that decides is already
 * in the image.
 *
 * Deliberately not a separate `--psm 0` call that parses an orientation and a
 * confidence out of stderr. That would buy a threshold to tune, two warning
 * strings to interpret, and the ability to turn somebody's page the wrong way
 * round. Leaving the decision inside Tesseract means a wrong call costs a poor
 * text read, which is already the worst case on this path, and our pixels are
 * never touched.
 */
export async function readPageText(image: Buffer): Promise<string> {
  return (await tesseract(image, { psm: "1" })).trim();
}

/**
 * One upright, straight, greyscale page — derived for reading, then discarded.
 *
 * The stored file is never touched. The vault keeps the bytes it was handed; a
 * lossy re-encode of somebody's passport to improve a machine's guess is the
 * wrong trade, and a cropping mistake on the only copy is unrecoverable. This
 * lives for the length of one read.
 *
 * The order is load-bearing:
 *
 *   `autoOrient` first, because every crop below it is computed in displayed
 *   coordinates and sharp does not do this on load — the pixels of a sideways
 *   phone photo are the only truth once the tag is dropped.
 *
 *   Rotate second, by the measured angle, only when the measurement was
 *   confident enough to act on.
 *
 *   Trim last. A dark scanner edge stops a trim dead if it runs first, and
 *   trimming afterwards also removes the white wedges the rotation added.
 */
export async function preparePage(
  image: Buffer,
): Promise<{ bytes: Buffer; how: string }> {
  const sharp = (await import("sharp")).default;
  const { findSkew, worthStraightening } = await import("./image-prep.server");

  const skew = await findSkew(image).catch(() => null);
  const straighten = worthStraightening(skew);

  let pipeline = sharp(image).autoOrient();
  if (straighten) pipeline = pipeline.rotate(skew.angle, { background: "white" });

  const prepared = await pipeline.trim({ threshold: 15 }).greyscale().png().toBuffer();

  // A trim that ate the page means the threshold met something unexpected —
  // a dark border, an inverted scan. Fall back to the untrimmed page rather
  // than hand the reader a sliver.
  const meta = await sharp(prepared).metadata();
  const survived = (meta.width ?? 0) * (meta.height ?? 0) >= 250_000;

  let base = survived
    ? sharp(prepared)
    : (straighten
        ? sharp(image).autoOrient().rotate(skew.angle, { background: "white" })
        : sharp(image).autoOrient()
      ).greyscale();

  const final = await base.metadata();
  if ((final.width ?? 0) * (final.height ?? 0) > MAX_PIXELS) {
    // The occasional photograph of a wall is what takes the container's memory
    // with it, not the average page.
    base = base.resize({ width: 4000, withoutEnlargement: true });
  }

  return {
    bytes: await base.png().toBuffer(),
    how: straighten
      ? `Straightened by ${Math.abs(skew.angle).toFixed(1)}° before reading. `
      : "",
  };
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

/**
 * One call to the binary, the page piped in and the answer piped out, with a
 * hard timeout. Nothing touches the disk: a page in a temporary file outlives
 * a process that dies mid-read, as an unencrypted picture of somebody's papers.
 *
 * No wrapper package: every one of them is abandoned, and this is shorter than
 * their documentation. `OMP_THREAD_LIMIT=1` keeps one page from taking every
 * core on a machine that is also serving the vault.
 */
async function piped(image: Buffer, args: string[]): Promise<Buffer> {
  const call = run("tesseract", ["stdin", "stdout", ...args], {
    timeout: TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    encoding: "buffer",
    env: { ...process.env, OMP_THREAD_LIMIT: "1" },
  });
  // A binary that stops before reading all of it closes the pipe. That failure
  // is the call's to report, not an unhandled error on the stream.
  call.child.stdin?.on("error", () => {});
  call.child.stdin?.end(image);
  return (await call).stdout;
}

async function tesseract(
  image: Buffer,
  options: { model?: string; psm: string; whitelist?: string },
): Promise<string> {
  const args = ["--psm", options.psm, "--oem", "1"];

  if (options.model) {
    args.push("--tessdata-dir", EXTRA_TESSDATA, "-l", options.model);
  } else {
    args.push("-l", "eng");
  }

  if (options.whitelist) {
    args.push("-c", `tessedit_char_whitelist=${options.whitelist}`);
  }

  return (await piped(image, args)).toString("utf8");
}

/**
 * An invisible text layer for one page image: a PDF page holding only the
 * words Tesseract read, each where it sits on the page, drawn in no colour.
 * Laid over the picture it makes the page searchable and selectable in any
 * PDF viewer. Null when the reader is not installed or cannot read the page;
 * a page without a text layer is still a page.
 */
export async function textLayer(image: Buffer): Promise<Buffer | null> {
  if (!(await readerAvailable())) return null;
  try {
    return await piped(image, ["-l", "eng", "--psm", "3", "-c", "textonly_pdf=1", "pdf"]);
  } catch {
    // Not logged: the error could quote the page.
    return null;
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
 * MRZ dates are two digits of year, so a century has to be guessed. A birth
 * date is in the past. An expiry is at most a passport's ten years ahead, but
 * often behind — expired passports are filed too — so it is read as this
 * century unless that puts it more than twenty years out.
 */
function fromMrzDate(value: string, lean: "future" | "past"): string | null {
  if (!/^\d{6}$/.test(value)) return null;

  const now = new Date().getFullYear();
  const month = value.slice(2, 4);
  const day = value.slice(4, 6);
  let year = now - (now % 100) + Number(value.slice(0, 2));
  if (year > now + (lean === "future" ? 20 : 0)) year -= 100;

  const iso = `${year}-${month}-${day}`;
  // Date.parse takes 2027-02-31 and rolls it into March; this does not.
  return normaliseDate(iso);
}

/** Dates a document labels as its own expiry, and nothing else. */
const EXPIRY_LABEL =
  /(?:expir\w*|valid\s+(?:un)?til|use\s+before)\D{0,20}?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i;

/**
 * What can be guessed from loose text, which is very little on purpose.
 *
 * Only a date the document itself labels as an expiry is offered. Pulling every
 * date off a page and picking the latest produces a confident wrong answer, and
 * a confident wrong renewal date is the failure this whole design is arranged
 * to avoid.
 */
export function proposalsFromText(
  text: string,
  source: Proposal["source"] = "page-text",
): Proposal[] {
  const match = EXPIRY_LABEL.exec(text);
  if (!match) return [];

  const date = normaliseDate(match[1]);
  if (!date) return [];

  return [
    {
      field: "expires_on",
      value: date,
      source,
      verified: false,
      note: "Found next to the word 'expires'. Check it against the document.",
    },
  ];
}

/**
 * A printed date as the vault stores it (YYYY-MM-DD), or null. Only a day the
 * calendar has: a misread "38/06/2027" is nothing, not a value the database
 * refuses when it is saved.
 */
export function normaliseDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (iso) return realDate(iso[1], Number(iso[2]), Number(iso[3]));

  const named = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(raw.trim());
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    return realDate(named[3], month, Number(named[1]));
  }

  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(raw.trim());
  if (numeric) {
    const [, first, second, year] = numeric;
    // Day-first, because this household is not American and the ambiguous
    // cases are better left to a person than guessed at.
    if (Number(second) > 12) return null;
    return realDate(fullYear(year), Number(second), Number(first));
  }

  return null;
}

function realDate(year: string, month: number, day: number): string | null {
  const date = new Date(Date.UTC(Number(year), month - 1, day));
  const real = date.getUTCFullYear() === Number(year) && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? `${year}-${pad(month)}-${pad(day)}` : null;
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
    const parsed = await readPdf(bytes).catch(() => null);
    const text = (parsed?.pages ?? []).join("\n\n").trim();

    if (text.length > 40) {
      const { readTerms } = await import("./terms.server");
      const terms = readTerms(parsed!.lines);

      // When the document is recognisably insurance paperwork, its own
      // structure is a better guide than a regex over flattened text: the
      // figures live on the schedule, and a label matched anywhere else is
      // matched against the wrong page. Fall back only when nothing was
      // recognised.
      const recognised = terms.sections.some((s) => s.type !== "wording");

      return {
        proposals: recognised
          ? terms.proposals
          : proposalsFromText(text, "pdf-text"),
        text,
        terms,
        how: recognised
          ? terms.how
          : "Read from the PDF's own text. Nothing was scanned or guessed.",
      };
    }

    return readScannedPdf(bytes);
  }

  if (!(await readerAvailable())) {
    return {
      proposals: [],
      text: "",
      how: "The reader is not installed in this environment.",
    };
  }

  return readImage(bytes);
}

/**
 * A PDF with no text of its own: a picture of a document in a wrapper. Each
 * page is drawn as an image (pdf-pages.server.ts) and read as a photo would
 * be. The first page to propose a field wins, so a passport's data page read
 * first is not overruled by a visa page after it.
 */
async function readScannedPdf(bytes: Buffer): Promise<ReadResult> {
  if (!(await readerAvailable())) {
    return {
      proposals: [],
      text: "",
      how: "This PDF holds no text of its own, and the reader is not installed in this environment.",
    };
  }

  const { MAX_PAGES, pagesAsImages } = await import("./pdf-pages.server");
  const pages = await pagesAsImages(bytes).catch(() => null);
  if (!pages?.length) {
    return { proposals: [], text: "", how: "This PDF could not be opened to read its pages." };
  }

  const reads: ReadResult[] = [];
  for (const page of pages) reads.push(await readImage(page.png));

  const seen = new Set<string>();
  const proposals = reads.flatMap((r) => r.proposals).filter((p) => !seen.has(p.field) && seen.add(p.field));
  const text = reads.map((r) => r.text).filter(Boolean).join("\n\n");
  const capped = pages.length === MAX_PAGES ? ` Only the first ${MAX_PAGES} pages were read.` : "";

  return {
    proposals,
    text,
    how: `This PDF is a scan, so its pages were read as pictures. ${reads[0].how}${capped}`,
  };
}

/** One photographed or scanned page: the passport strip if there is one, then the page's text. */
async function readImage(bytes: Buffer): Promise<ReadResult> {
  // Prepared once and shared, so the two readers cannot disagree about which
  // way up the page is.
  const page = await preparePage(bytes).catch(() => ({ bytes, how: "" }));

  const hasMrzModel = await mrzModelAvailable();
  const mrz = hasMrzModel ? await readMrz(page.bytes).catch(() => null) : null;

  if (mrz?.valid) {
    return {
      proposals: proposalsFromMrz(mrz.fields),
      text: "",
      how: `${page.how}Read from the machine-readable strip, and the check digits agree.`,
    };
  }

  const text = await readPageText(page.bytes).catch(() => "");

  return {
    proposals: proposalsFromText(text),
    text,
    how:
      page.how +
      (hasMrzModel
        ? ""
        : "The passport model is not installed, so no identity document can be read here — see tessdata/README.md. ") +
      (text
        ? "Read from the page. Nothing here is checked — confirm anything it filled in."
        : "Nothing could be read from this page."),
  };
}
