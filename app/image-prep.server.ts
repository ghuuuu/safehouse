/**
 * How crooked a page is, or a refusal to say.
 *
 * Tilt is the single most damaging thing about a household's scans: one
 * benchmark recovered 81% of an invoice's numeric fields upright and 31% at
 * three to five degrees. That cliff is bigger than the gap between this OCR
 * engine and the best one money cannot buy, which is why this exists at all.
 *
 * The method is a projection profile — shear the page by a candidate angle,
 * stack the rows, and see how cleanly the text lines pile up. The scoring is
 * Leptonica's differential square sum rather than a plain variance of row
 * sums, because the difference between neighbouring rows rejects the
 * background noise that scales with how much ink is on the page, and keeps
 * working on a two-column layout. Leptonica's own constants are better
 * defaults than anything invented here.
 *
 * It returns a confidence and is willing to say nothing. A page it cannot read
 * is left alone, because rotating a document on a bad guess makes it worse and
 * this runs unattended.
 *
 * Nothing in this module logs. How much ink is on a page, printed next to a
 * file name, is document content (CLAUDE.md).
 */

export type Skew = {
  /** Degrees. Pass straight to sharp's rotate — see the sign note below. */
  angle: number;
  /** Best score over the median score. Below about 5, do not believe it. */
  confidence: number;
};

/**
 * Mandatory, not an optimisation. A flatbed scan often carries a dark band
 * where the lid did not reach, and that band is a long straight edge at zero
 * degrees which outscores the real text every time. Measured: with no margin
 * crop, a page skewed five degrees reports zero at a confidence that looks
 * perfectly healthy.
 */
const MARGIN = 0.05;

const MAX_WIDTH = 800;

/**
 * A reduction factor rather than a target width, because the averaging that
 * happens during the downscale *is* the noise filter — a 150 dpi scan needs the
 * same factor as a 300 dpi one, not the same final width.
 */
const MIN_SHRINK = 3;

/** Beyond this is a quarter turn, which is Tesseract's job, not this one. */
const SWEEP = 15;
const COARSE = 0.5;
const FINE = 0.05;
const MIN_POINTS = 50;

export async function findSkew(image: Buffer): Promise<Skew> {
  const sharp = (await import("sharp")).default;

  const meta = await sharp(image).metadata();

  // `metadata()` reports the stored pixels and ignores any `autoOrient()` in a
  // pipeline, so a phone photo tagged sideways needs its dimensions swapped
  // here or every crop below is computed against the wrong edge.
  const turned = (meta.orientation ?? 1) >= 5;
  const width = (turned ? meta.height : meta.width) ?? 0;
  const height = (turned ? meta.width : meta.height) ?? 0;

  if (width < 200 || height < 200) return { angle: 0, confidence: 0 };

  const mx = Math.round(width * MARGIN);
  const my = Math.round(height * MARGIN);

  const { data, info } = await sharp(image)
    // Before extract, always: the other order crops the wrong edge and throws
    // nothing.
    .autoOrient()
    .extract({
      left: mx,
      top: my,
      width: width - 2 * mx,
      height: height - 2 * my,
    })
    .greyscale()
    .resize({
      width: Math.min(MAX_WIDTH, Math.round((width - 2 * mx) / MIN_SHRINK)),
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // sharp will accept a raw buffer whose length disagrees with its declared
  // channel count and quietly use the first slice. Assert rather than discover.
  if (info.channels !== 1) {
    throw new Error(`expected one channel, got ${info.channels}`);
  }

  const w = info.width;
  const h = info.height;

  // A percentile rather than Otsu: on a sparse page — a passport, a short
  // letter — Otsu puts the cut inside the paper-noise distribution and decides
  // the whole page is ink.
  const histogram = new Uint32Array(256);
  for (const value of data) histogram[value] += 1;

  const percentile = (fraction: number) => {
    let seen = 0;
    const want = fraction * data.length;
    for (let i = 0; i < 256; i += 1) {
      seen += histogram[i];
      if (seen >= want) return i;
    }
    return 255;
  };

  const cut = Math.min(percentile(0.04), Math.floor(percentile(0.5) * 0.9));

  // The bottom edge of each stroke, which is roughly a baseline point. About
  // ten thousand of those instead of a hundred thousand ink pixels, and they
  // carry the signal the stacking is looking for.
  const xs: number[] = [];
  const ys: number[] = [];

  for (let y = 0; y < h - 1; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[y * w + x] <= cut && data[(y + 1) * w + x] > cut) {
        xs.push(x);
        ys.push(y);
      }
    }
  }

  if (xs.length < MIN_POINTS) return { angle: 0, confidence: 0 };

  const half = w / 2;

  const score = (degrees: number) => {
    const slope = Math.tan((degrees * Math.PI) / 180);
    const bins = new Float64Array(h + 2);

    for (let i = 0; i < xs.length; i += 1) {
      // The half-pixel offset removes an exact-zero bias: without it every
      // point lands whole in one bin at zero degrees, which outscores the true
      // angle and makes a crooked page report straight.
      const place = ys[i] + 0.5 + (xs[i] - half) * slope;
      const bin = Math.floor(place);
      if (bin < 0 || bin + 1 > h) continue;

      const fraction = place - bin;
      bins[bin] += 1 - fraction;
      bins[bin + 1] += fraction;
    }

    let sum = 0;
    for (let bin = 0; bin < h; bin += 1) {
      const difference = bins[bin] - bins[bin + 1];
      sum += difference * difference;
    }
    return sum;
  };

  const grid: [number, number][] = [];
  for (let angle = -SWEEP; angle <= SWEEP + 1e-9; angle += COARSE) {
    grid.push([angle, score(angle)]);
  }

  const best = grid.reduce((top, row) => (row[1] > top[1] ? row : top));
  const median = grid.map((row) => row[1]).sort((a, b) => a - b)[grid.length >> 1];

  let fine = best;
  for (
    let angle = best[0] - COARSE;
    angle <= best[0] + COARSE + 1e-9;
    angle += FINE
  ) {
    const value = score(angle);
    if (value > fine[1]) fine = [angle, value];
  }

  // One parabolic step through the three samples around the peak, which buys
  // another decimal place for three more evaluations.
  const below = score(fine[0] - FINE);
  const above = score(fine[0] + FINE);
  const curvature = below - 2 * fine[1] + above;

  return {
    angle:
      curvature !== 0
        ? fine[0] + (FINE / 2) * ((below - above) / curvature)
        : fine[0],
    confidence: median > 0 ? fine[1] / median : 0,
  };
}

/**
 * Whether a measurement is worth acting on.
 *
 * Below a third of a degree there is nothing to gain and a re-encode to lose.
 * Below the confidence floor the page did not give a clear answer — a blank
 * form, a photograph, a page of one line — and leaving it alone is right.
 */
export function worthStraightening(skew: Skew | null): skew is Skew {
  return skew !== null && Math.abs(skew.angle) >= 0.3 && skew.confidence >= 5;
}
