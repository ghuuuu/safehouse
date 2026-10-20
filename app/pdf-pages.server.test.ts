/**
 * A PDF's pages drawn as pictures for the reader (D27). Every PDF here is made
 * by the test.
 */

import { PDFDocument } from "@cantoo/pdf-lib";
import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { MAX_PAGES, pagesAsImages } from "./pdf-pages.server";

async function pdfOf(sizes: [number, number][]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const size of sizes) pdf.addPage(size);
  return Buffer.from(await pdf.save());
}

describe("a PDF as pictures", () => {
  test("an A4 page comes out at 300 dpi, A4 in pixels", async () => {
    const [page] = await pagesAsImages(await pdfOf([[595.28, 841.89]]));
    const meta = await sharp(page.png).metadata();
    expect(page.dpi).toBe(300);
    // PDFium measures a page in whole points, so A4 comes out a few pixels short.
    expect(Math.abs(meta.width! - 2480)).toBeLessThanOrEqual(5);
    expect(Math.abs(meta.height! - 3508)).toBeLessThanOrEqual(5);
  });

  test("one page can be asked for on its own, and one that is not there gives nothing", async () => {
    const pdf = await pdfOf([[595.28, 841.89], [300, 200]]);
    const [second] = await pagesAsImages(pdf, { only: 1 });
    expect((await sharp(second.png).metadata()).width).toBe(1250);
    expect(await pagesAsImages(pdf, { only: 5 })).toEqual([]);
  });

  test("a long PDF is read only so far, and a huge page at a lower resolution", async () => {
    const pages = await pagesAsImages(await pdfOf(Array.from({ length: MAX_PAGES + 3 }, () => [200, 200] as [number, number])));
    expect(pages).toHaveLength(MAX_PAGES);
    const [poster] = await pagesAsImages(await pdfOf([[2384, 3370]]));
    const meta = await sharp(poster.png).metadata();
    expect(poster.dpi).toBeLessThan(300);
    expect(meta.width! * meta.height!).toBeLessThanOrEqual(40_000_000);
  });

  test("something that is not a PDF is refused", async () => {
    await expect(pagesAsImages(Buffer.from("not a pdf"))).rejects.toThrow();
  });
});
