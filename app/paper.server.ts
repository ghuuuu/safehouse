/**
 * A photograph becomes a page the size of the paper in it, and pages become one
 * PDF (D39).
 *
 * Three steps, each its own function so the review screen can stop between
 * them: find the paper's four corners in the photo, warp the photo flat onto
 * those corners at the real size, and build the PDF from the flattened pages
 * and any pages copied from uploaded PDFs. Then the PDF is read back and
 * checked before anything is filed from it.
 *
 * OpenCV runs here, on the server (D26: nothing leaves the machine). Nothing in
 * this module logs: a page's size and corners say what kind of paper it is.
 */

import { createRequire } from "node:module";

import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import type cvModule from "@techstark/opencv-js";
import sharp from "sharp";

import { mmToPt, PAPER_SIZES, type PaperSize } from "./paper";

/** The same ceiling the reader keeps (ocr.server.ts): a decoded page this big is an attack, not a scan. */
const MAX_PIXELS = 40_000_000;

/** Pages are drawn at 300 dpi: what a print shop calls print quality. */
const DPI = 300;

export type Point = [number, number];
/** Clockwise from top left, in the photo's upright pixels. */
export type Corners = [Point, Point, Point, Point];

type Cv = typeof cvModule;
let ready: Promise<{ cv: Cv }> | null = null;

/**
 * OpenCV's WebAssembly starts once per process, on first use. The module is a
 * thenable that resolves to itself, so it is never awaited bare: a promise
 * resolved with a thenable follows it again, forever. It is carried out in an
 * object instead, and callers take it out: `const { cv } = await opencv()`.
 *
 * Loaded by Node's own `require` rather than imported: Vite's module runner
 * (dev server, tests) hangs transforming the 10 MB file, which Node loads in a
 * tenth of a second.
 */
function opencv(): Promise<{ cv: Cv }> {
  ready ??= new Promise((resolve) => {
    const module = createRequire(import.meta.url)("@techstark/opencv-js") as PromiseLike<Cv>;
    module.then((cv) => resolve({ cv }));
  });
  return ready;
}

function upright(image: Buffer) {
  // `autoOrient` because sharp does not honour the orientation tag on load (D29).
  return sharp(image, { limitInputPixels: MAX_PIXELS }).autoOrient();
}

/** Corners in the order the warp expects, whatever order the outline came in. */
export function ordered(points: Point[]): Corners {
  const bySum = [...points].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const byDiff = [...points].sort((a, b) => a[0] - a[1] - (b[0] - b[1]));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]];
}

/**
 * The paper's outline: the largest convex four-sided shape covering at least a
 * fifth of the photo. When there is none (the paper fills the frame, or sits on
 * something the same colour) the photo's own edges are returned and `found` is
 * false, and the review screen says so.
 */
export async function findCorners(image: Buffer): Promise<{ corners: Corners; found: boolean; width: number; height: number }> {
  const { cv } = await opencv();
  const full = await upright(image).toBuffer({ resolveWithObject: true });
  const width = full.info.width;
  const height = full.info.height;
  const edges: Corners = [[0, 0], [width, 0], [width, height], [0, height]];

  // Found on a small copy: faster, and the blur that happens on the way down is
  // the first noise filter.
  const scale = Math.min(1, 1000 / Math.max(width, height));
  const small = await sharp(full.data)
    .resize(Math.round(width * scale), Math.round(height * scale))
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const grey = cv.matFromArray(small.info.height, small.info.width, cv.CV_8UC1, Array.from(small.data));
  const edgesMat = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  try {
    cv.GaussianBlur(grey, grey, new cv.Size(5, 5), 0);
    cv.Canny(grey, edgesMat, 50, 150);
    cv.dilate(edgesMat, edgesMat, kernel);
    cv.findContours(edgesMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const floor = small.info.width * small.info.height * 0.2;
    let best: Point[] | null = null;
    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * cv.arcLength(contour, true), true);
      const area = cv.contourArea(approx);
      if (approx.rows === 4 && area > floor && area > bestArea && cv.isContourConvex(approx)) {
        bestArea = area;
        best = [0, 1, 2, 3].map((k) => [approx.data32S[k * 2] / scale, approx.data32S[k * 2 + 1] / scale] as Point);
      }
      approx.delete();
      contour.delete();
    }
    return best ? { corners: ordered(best), found: true, width, height } : { corners: edges, found: false, width, height };
  } finally {
    grey.delete();
    edgesMat.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
  }
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A preset or typed size in millimetres, turned the way the outline lies. */
export function sizeFor(size: Exclude<PaperSize, "scanned">, corners: Corners): { w: number; h: number } {
  const across = (distance(corners[0], corners[1]) + distance(corners[3], corners[2])) / 2;
  const down = (distance(corners[0], corners[3]) + distance(corners[1], corners[2])) / 2;
  const [long, short] =
    typeof size === "string" ? [PAPER_SIZES[size].long, PAPER_SIZES[size].short] : [Math.max(size.w, size.h), Math.min(size.w, size.h)];
  return across >= down ? { w: long, h: short } : { w: short, h: long };
}

/**
 * A flatbed scan's own size, from the resolution it recorded. Null when it
 * recorded none, or 72 dpi, which is what software writes when it does not know.
 */
export async function scannedSize(image: Buffer): Promise<{ w: number; h: number } | null> {
  const meta = await sharp(image, { limitInputPixels: MAX_PIXELS }).metadata();
  const dpi = meta.density;
  if (!dpi || dpi < 100 || !meta.width || !meta.height) return null;
  const turned = (meta.orientation ?? 1) >= 5;
  const [w, h] = turned ? [meta.height, meta.width] : [meta.width, meta.height];
  return { w: (w / dpi) * 25.4, h: (h / dpi) * 25.4 };
}

/**
 * The photo warped flat onto its corners, at exactly `mm` and 300 dpi, then
 * turned a quarter at a time if asked. JPEG at quality 92 (D39).
 */
export async function flatten(
  image: Buffer,
  corners: Corners,
  mm: { w: number; h: number },
  rotation = 0,
): Promise<{ jpeg: Buffer; mm: { w: number; h: number } }> {
  const { cv } = await opencv();
  const outW = Math.round((mm.w / 25.4) * DPI);
  const outH = Math.round((mm.h / 25.4) * DPI);

  const raw = await upright(image).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const source = new cv.Mat(raw.info.height, raw.info.width, cv.CV_8UC3);
  source.data.set(raw.data);
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat());
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);
  const transform = cv.getPerspectiveTransform(from, to);
  const flat = new cv.Mat();
  try {
    cv.warpPerspective(source, flat, transform, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const jpeg = await sharp(Buffer.from(flat.data), { raw: { width: outW, height: outH, channels: 3 } })
      .rotate(rotation)
      .withMetadata({ density: DPI })
      .jpeg({ quality: 92 })
      .toBuffer();
    const turned = rotation === 90 || rotation === 270;
    return { jpeg, mm: turned ? { w: mm.h, h: mm.w } : mm };
  } finally {
    source.delete();
    from.delete();
    to.delete();
    transform.delete();
    flat.delete();
  }
}

export type BuiltPage =
  | {
      kind: "image";
      bytes: Buffer;
      format: "jpg" | "png";
      mm: { w: number; h: number };
      /** The untouched photo this page was made from, attached inside the PDF. */
      original?: { bytes: Buffer; mime: string; name: string };
      /** A one-page PDF of invisible words, laid over the picture (`textLayer`). */
      text?: Buffer | null;
    }
  | { kind: "pdf"; source: Buffer; index: number; rotation: number; text?: Buffer | null };

/** What a built PDF must turn out to be: each page's size in points, and how many attachments. */
export type Expected = { pages: { w: number; h: number }[]; attachments: number };

/**
 * One PDF from the intake's pages, in order. A page from an uploaded PDF is
 * copied in at its own size; an image page is drawn edge to edge on a page of
 * exactly its size. Returns the bytes and what `checkPdf` should find in them.
 */
export async function buildPdf(title: string, pages: BuiltPage[]): Promise<{ bytes: Buffer; expected: Expected }> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("Safehouse");
  pdf.setProducer("Safehouse");

  const expected: Expected = { pages: [], attachments: 0 };
  const sources = new Map<Buffer, PDFDocument>();

  for (const page of pages) {
    if (page.kind === "pdf") {
      let source = sources.get(page.source);
      if (!source) {
        source = await PDFDocument.load(page.source, { updateMetadata: false });
        sources.set(page.source, source);
      }
      const [copied] = await pdf.copyPages(source, [page.index]);
      // Only on a page drawn the right way up: a page that turns itself (its
      // own /Rotate) is drawn turned by PDFium, so words read from that picture
      // would sit crosswise over the unturned page beneath.
      // ponytail: turned scans get no text layer; map the words through the turn if they ever matter.
      if (page.text && copied.getRotation().angle % 360 === 0) {
        await overlay(pdf, copied, page.text, copied.getSize().width, copied.getSize().height);
      }
      if (page.rotation) copied.setRotation(degrees((copied.getRotation().angle + page.rotation) % 360));
      pdf.addPage(copied);
      const { width, height } = copied.getSize();
      expected.pages.push({ w: width, h: height });
      continue;
    }

    const w = mmToPt(page.mm.w);
    const h = mmToPt(page.mm.h);
    const embedded = page.format === "jpg" ? await pdf.embedJpg(page.bytes) : await pdf.embedPng(page.bytes);
    const drawn = pdf.addPage([w, h]);
    drawn.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
    if (page.text) await overlay(pdf, drawn, page.text, w, h);
    expected.pages.push({ w, h });

    if (page.original) {
      await pdf.attach(page.original.bytes, page.original.name, {
        mimeType: page.original.mime,
        description: "The photograph this page was made from",
      });
      expected.attachments += 1;
    }
  }

  return { bytes: Buffer.from(await pdf.save()), expected };
}

/**
 * Lay a page of invisible words over a page, stretched to cover it exactly.
 * A text layer that will not open is left off: the page is still the page.
 */
async function overlay(pdf: PDFDocument, page: ReturnType<PDFDocument["addPage"]>, text: Buffer, w: number, h: number) {
  try {
    const [layer] = await pdf.embedPdf(text, [0]);
    page.drawPage(layer, { x: 0, y: 0, width: w, height: h });
  } catch {
    // Not logged, and not fatal.
  }
}

/**
 * Read a built PDF back and refuse it unless it is what was asked for: the
 * same number of pages, each the expected size to half a point, and every
 * original attached. Nothing is filed from a PDF that fails this.
 */
export async function checkPdf(bytes: Buffer, expected: Expected): Promise<void> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdf.getPages();
  if (pages.length !== expected.pages.length) {
    throw new Error(`The built PDF has ${pages.length} pages; ${expected.pages.length} were expected.`);
  }
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const want = expected.pages[i];
    if (Math.abs(width - want.w) > 0.5 || Math.abs(height - want.h) > 0.5) {
      throw new Error(`Page ${i + 1} of the built PDF is not the size it should be.`);
    }
  });
  if (pdf.getAttachments().length !== expected.attachments) {
    throw new Error("The built PDF is missing an attached original.");
  }
}
