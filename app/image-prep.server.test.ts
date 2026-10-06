/**
 * Whether the page straightener measures what it claims to.
 *
 * Three assertions, each of which fails if the logic breaks in a way that
 * matters. The sign test is the important one: the arithmetic here returns
 * roughly minus the rotation that was applied, so a correction written with
 * the sign flipped would double the skew instead of removing it — and would
 * look like a working feature right up until somebody read the output.
 */

import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { findSkew, worthStraightening } from "./image-prep.server";

/** Lines of text on white, which is all the estimator looks at. */
async function page(options: { rotate?: number; darkEdge?: boolean } = {}) {
  const width = 1200;
  const height = 1600;

  const lines = Array.from({ length: 34 }, (_, row) => {
    const y = 80 + row * 44;
    const length = 300 + ((row * 137) % 700);
    return `<rect x="90" y="${y}" width="${length}" height="18" fill="#222"/>`;
  }).join("");

  const edge = options.darkEdge
    ? `<rect x="0" y="0" width="${width}" height="26" fill="#111"/>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="white"/>${lines}${edge}</svg>`;

  const flat = await sharp(Buffer.from(svg)).png().toBuffer();

  if (!options.rotate) return flat;

  return sharp(flat)
    .rotate(options.rotate, { background: "white" })
    .png()
    .toBuffer();
}

describe("measuring a crooked page", () => {
  test("a straight page is reported as straight", async () => {
    const skew = await findSkew(await page());

    expect(Math.abs(skew.angle)).toBeLessThan(0.3);
    expect(worthStraightening(skew)).toBe(false);
  });

  test("it finds a real tilt, to within a tenth of a degree", async () => {
    const skew = await findSkew(await page({ rotate: 3.2 }));

    expect(worthStraightening(skew)).toBe(true);
    expect(Math.abs(Math.abs(skew.angle) - 3.2)).toBeLessThan(0.1);
  });

  test("the sign is right, so correcting makes the page straighter", async () => {
    // The assertion that catches a flipped sign. Applying the returned angle
    // must leave a page that measures as straight; the wrong sign leaves one
    // measuring twice as crooked, which no amount of reading the code catches
    // as reliably as this does.
    const crooked = await page({ rotate: -4.5 });
    const skew = await findSkew(crooked);

    const straightened = await sharp(crooked)
      .rotate(skew.angle, { background: "white" })
      .png()
      .toBuffer();

    expect(Math.abs((await findSkew(straightened)).angle)).toBeLessThan(0.3);
  });

  test.each([-7.5, -1.2, 2.4, 9])(
    "measures %s degrees",
    async (angle) => {
      const skew = await findSkew(await page({ rotate: angle }));

      expect(Math.abs(Math.abs(skew.angle) - Math.abs(angle))).toBeLessThan(0.15);
    },
  );
});

describe("when it refuses", () => {
  test("a blank page produces no angle and no confidence", async () => {
    const blank = await sharp({
      create: { width: 1200, height: 1600, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();

    const skew = await findSkew(blank);

    expect(skew).toEqual({ angle: 0, confidence: 0 });
    expect(worthStraightening(skew)).toBe(false);
  });

  test("something too small to be a page is left alone", async () => {
    const stamp = await sharp({
      create: { width: 120, height: 120, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();

    expect(await findSkew(stamp)).toEqual({ angle: 0, confidence: 0 });
  });
});

describe("the margin crop", () => {
  test("a dark scanner edge does not defeat the measurement", async () => {
    // A flatbed scan often carries a band where the lid did not reach. That
    // band is a long straight edge at zero degrees, and it outscores the real
    // text unless it is cropped away first — measured as reporting zero on a
    // page that is visibly crooked, at a confidence that looks healthy.
    const skew = await findSkew(await page({ rotate: 5, darkEdge: true }));

    expect(worthStraightening(skew)).toBe(true);
    expect(Math.abs(Math.abs(skew.angle) - 5)).toBeLessThan(0.3);
  });
});
