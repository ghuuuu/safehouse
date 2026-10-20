/**
 * The pages of a PDF as pictures, for a reader that only reads pictures (D27).
 *
 * A scanned PDF is a photograph in a wrapper: no text layer, so Tesseract has
 * to be shown each page as an image. PDFium (the engine inside Chrome, built
 * to WebAssembly) draws them here, on this machine (D26).
 *
 * Nothing in this module logs: a page count and size say what kind of paper
 * it is.
 */

import { createRequire } from "node:module";

import sharp from "sharp";

type Library = Awaited<ReturnType<typeof import("@hyzyla/pdfium").PDFiumLibrary.init>>;
let ready: Promise<Library> | null = null;

/**
 * Started once per process. Loaded by Node's own `require`, as OpenCV is
 * (paper.server.ts): Vite's module runner is not trusted with a WebAssembly
 * blob this size.
 */
function pdfium(): Promise<Library> {
  ready ??= (createRequire(import.meta.url)("@hyzyla/pdfium") as typeof import("@hyzyla/pdfium")).PDFiumLibrary.init();
  return ready;
}

/** 300 dpi: what Tesseract is tuned for. */
const DPI = 300;
/** The same ceiling the reader keeps for a photo (ocr.server.ts). */
const MAX_PIXELS = 40_000_000;
/**
 * The most pages read from one PDF. A passport, a certificate or a bill puts
 * what matters on its first pages; a 300-page policy read in full would hold a
 * home server for minutes.
 */
export const MAX_PAGES = 10;

/**
 * Each page as a greyscale PNG at 300 dpi (less, for a page so large that 300
 * dpi would exceed the pixel ceiling), up to `max`, or only page `only`.
 * Throws for a PDF PDFium cannot open.
 */
export async function pagesAsImages(
  bytes: Buffer,
  { max = MAX_PAGES, only }: { max?: number; only?: number } = {},
): Promise<{ png: Buffer; dpi: number }[]> {
  const library = await pdfium();
  const document = await library.loadDocument(new Uint8Array(bytes));
  try {
    const count = document.getPageCount();
    const indices = only === undefined ? [...Array(Math.min(max, count)).keys()] : only < count ? [only] : [];
    const out: { png: Buffer; dpi: number }[] = [];
    for (const i of indices) {
      const page = document.getPage(i);
      try {
        const { originalWidth: width, originalHeight: height } = page.getOriginalSize();
        const fit = Math.sqrt(MAX_PIXELS / Math.max(1, ((width * DPI) / 72) * ((height * DPI) / 72)));
        const dpi = Math.floor(DPI * Math.min(1, fit));
        const image = await page.render({
          scale: dpi / 72,
          colorSpace: "Gray",
          render: (raw) => sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 1 } }).withMetadata({ density: dpi }).png().toBuffer(),
        });
        out.push({ png: Buffer.from(image.data), dpi });
      } finally {
        page.close();
      }
    }
    return out;
  } finally {
    document.destroy();
  }
}
