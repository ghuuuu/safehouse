/**
 * A photographed card comes back flat and the size of a card; pages become one
 * PDF of exactly the sizes asked for (D39). Every image here is drawn by the
 * test: a blank card on a dark table, nothing anybody owns.
 */

import { PDFDocument } from "@cantoo/pdf-lib";
import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { mmToPt, sizesShaped } from "./paper";
import { buildPdf, checkPdf, type Corners, findCorners, flatten, ordered, scannedSize, sizeFor } from "./paper.server";

/** A card 856 × 540 px turned `angle` degrees about (800, 600), its corners clockwise from top left. */
function card(angle: number): Corners {
  const t = (angle * Math.PI) / 180;
  const at = (x: number, y: number): [number, number] => [
    800 + x * Math.cos(t) - y * Math.sin(t),
    600 + x * Math.sin(t) + y * Math.cos(t),
  ];
  return [at(-428, -270), at(428, -270), at(428, 270), at(-428, 270)];
}

/** The same turn, for a point on the card, so a mark can be drawn on it. */
function onCard(angle: number, x: number, y: number): string {
  const t = (angle * Math.PI) / 180;
  return `${800 + x * Math.cos(t) - y * Math.sin(t)},${600 + x * Math.sin(t) + y * Math.cos(t)}`;
}

/** A pale card on a dark table, with a black square near its top left corner. */
async function photo(angle: number): Promise<Buffer> {
  const corners = card(angle).map((p) => p.join(",")).join(" ");
  const mark = [
    onCard(angle, -388, -230),
    onCard(angle, -288, -230),
    onCard(angle, -288, -130),
    onCard(angle, -388, -130),
  ].join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
    <rect width="1600" height="1200" fill="#2b2b2b"/>
    <polygon points="${corners}" fill="#f0efe8"/>
    <polygon points="${mark}" fill="#000000"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

async function meanOf(jpeg: Buffer, left: number, top: number, size: number): Promise<number> {
  const { data } = await sharp(jpeg).extract({ left, top, width: size, height: size }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data.reduce((sum, v) => sum + v, 0) / data.length;
}

describe("the shape of a page", () => {
  test("a card's outline is a card, and only a card", () => {
    expect(sizesShaped(856, 540)).toEqual(["id1"]);
  });

  test("an outline near the square root of two asks, because A4, A5 and a passport page all are", () => {
    expect(sizesShaped(1414, 1000).sort()).toEqual(["a4", "a5", "id3"]);
  });

  test("letter is its own shape", () => {
    expect(sizesShaped(2159, 2794)).toEqual(["letter"]);
  });

  test("a preset follows the way the outline lies", () => {
    expect(sizeFor("a4", [[0, 0], [100, 0], [100, 141], [0, 141]])).toEqual({ w: 210, h: 297 });
    expect(sizeFor("a4", [[0, 0], [141, 0], [141, 100], [0, 100]])).toEqual({ w: 297, h: 210 });
  });

  test("corners are put in order whichever order they arrive in", () => {
    expect(ordered([[10, 90], [90, 10], [10, 10], [90, 90]])).toEqual([[10, 10], [90, 10], [90, 90], [10, 90]]);
  });
});

describe("a photographed card", () => {
  test("its corners are found to within a few pixels", async () => {
    const found = await findCorners(await photo(8));
    expect(found.found).toBe(true);
    found.corners.forEach((corner, i) => {
      const want = card(8)[i];
      expect(Math.hypot(corner[0] - want[0], corner[1] - want[1])).toBeLessThan(12);
    });
  });

  test("a photo with no paper in it says so and offers its own edges", async () => {
    const blank = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#777" } }).jpeg().toBuffer();
    const found = await findCorners(blank);
    expect(found.found).toBe(false);
    expect(found.corners).toEqual([[0, 0], [800, 0], [800, 600], [0, 600]]);
  });

  test("it is flattened to exactly a card at 300 dpi, the mark where it belongs", async () => {
    const image = await photo(8);
    const { jpeg, mm } = await flatten(image, card(8), sizeFor("id1", card(8)));
    const meta = await sharp(jpeg).metadata();

    expect(mm).toEqual({ w: 85.6, h: 54 });
    expect([meta.width, meta.height]).toEqual([1011, 638]);
    expect(meta.density).toBe(300);
    // The mark sits 40-140 px in on an 856 px card: about 47-165 px at this size.
    expect(await meanOf(jpeg, 70, 70, 70)).toBeLessThan(60);
    expect(await meanOf(jpeg, 860, 480, 70)).toBeGreaterThan(200);
  });

  test("a quarter turn turns the page and its size", async () => {
    const { jpeg, mm } = await flatten(await photo(8), card(8), sizeFor("id1", card(8)), 90);
    const meta = await sharp(jpeg).metadata();
    expect(mm).toEqual({ w: 54, h: 85.6 });
    expect([meta.width, meta.height]).toEqual([638, 1011]);
  });
});

describe("a flatbed scan", () => {
  test("is the size its recorded resolution says", async () => {
    const scan = await sharp({ create: { width: 2480, height: 3508, channels: 3, background: "#fff" } })
      .withMetadata({ density: 300 })
      .png()
      .toBuffer();
    const size = await scannedSize(scan);
    expect(size!.w).toBeCloseTo(210, 0);
    expect(size!.h).toBeCloseTo(297, 0);
  });

  test("a resolution of 72 is a guess, and is not believed", async () => {
    const scan = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#fff" } })
      .withMetadata({ density: 72 })
      .png()
      .toBuffer();
    expect(await scannedSize(scan)).toBeNull();
  });
});

describe("one PDF", () => {
  async function emailedPdf(): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    pdf.addPage([595.28, 841.89]);
    return Buffer.from(await pdf.save());
  }

  test("a photographed card and a page of an emailed PDF, each at its own size, the photo attached", async () => {
    const original = await photo(8);
    const { jpeg, mm } = await flatten(original, card(8), sizeFor("id1", card(8)));
    const { bytes, expected } = await buildPdf("A blank card", [
      { kind: "image", bytes: jpeg, format: "jpg", mm, original: { bytes: original, mime: "image/jpeg", name: "page-1-original.jpg" } },
      { kind: "pdf", source: await emailedPdf(), index: 1, rotation: 0 },
    ]);

    await expect(checkPdf(bytes, expected)).resolves.toBeUndefined();

    const back = await PDFDocument.load(bytes);
    const [first, second] = back.getPages().map((p) => p.getSize());
    expect(first.width).toBeCloseTo(mmToPt(85.6), 2);
    expect(first.height).toBeCloseTo(mmToPt(54), 2);
    expect(second).toEqual({ width: 595.28, height: 841.89 });
    expect(Buffer.from(back.getAttachments()[0].data).equals(original)).toBe(true);
    expect(back.getTitle()).toBe("A blank card");
  });

  test("a PDF that is not what was asked for is refused", async () => {
    const { bytes, expected } = await buildPdf("Two pages", [
      { kind: "pdf", source: await emailedPdf(), index: 0, rotation: 0 },
    ]);
    await expect(checkPdf(bytes, { ...expected, pages: [{ w: 301, h: 400 }] })).rejects.toThrow(/not the size/);
    await expect(checkPdf(bytes, { ...expected, pages: [] })).rejects.toThrow(/pages/);
    await expect(checkPdf(bytes, { ...expected, attachments: 1 })).rejects.toThrow(/attached/);
  });
});
