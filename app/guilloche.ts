/**
 * The guilloché plate behind each page's name: interlaced waves and one
 * rosette, the engraving on a banknote or a passport's visa page.
 *
 * Drawn from a seed, so each page prints its own plate the way each
 * denomination of a note has its own, and the same page always prints the
 * same one. Pure: no randomness from outside the seed, the same paths on the
 * server and in the browser.
 *
 * Coordinates are in a 1200 × 200 box; the masthead scales it to fit.
 */

export const PLATE_WIDTH = 1200;
export const PLATE_HEIGHT = 200;

export type Plate = { waves: string[]; rosettes: string[] };

/** FNV-1a: a seed string to 32 bits. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small, well-mixed generator from that seed. */
function generator(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (random: () => number, low: number, high: number) => low + random() * (high - low);

function path(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function guilloche(seed: string): Plate {
  const random = generator(hash(seed));

  // Waves: strands of two summed sines, each a little out of phase with the
  // last, so together they weave rather than stack.
  const strands = 12;
  const f1 = Math.round(between(random, 3, 6));
  const f2 = Math.round(between(random, 7, 13));
  const a1 = between(random, 26, 40);
  const a2 = between(random, 8, 16);
  const shift1 = between(random, 0.18, 0.32);
  const shift2 = between(random, -0.5, -0.25);
  const phase = between(random, 0, Math.PI * 2);
  const waves: string[] = [];
  for (let s = 0; s < strands; s++) {
    const points: [number, number][] = [];
    for (let x = 0; x <= PLATE_WIDTH; x += 10) {
      const t = (x / PLATE_WIDTH) * Math.PI * 2;
      const y =
        PLATE_HEIGHT / 2 +
        a1 * Math.sin(f1 * t + phase + s * shift1) +
        a2 * Math.sin(f2 * t + s * shift2);
      points.push([x, y]);
    }
    waves.push(path(points));
  }

  // One rosette, at the right: concentric hypotrochoids whose ratio is a
  // fraction p/q, so each closes on itself after q turns.
  const p = [7, 9, 11, 13][Math.floor(random() * 4)];
  let q = Math.round(between(random, 2, 5));
  while (gcd(p, q) !== 1) q += 1;
  const cx = PLATE_WIDTH - 150;
  const cy = PLATE_HEIGHT / 2;
  const depth = between(random, 0.65, 1.05);
  const rosettes: string[] = [];
  for (const scale of [1, 0.78, 0.56]) {
    const big = 84 * scale;
    const small = (big * q) / p;
    const d = small * depth;
    const turns = Math.PI * 2 * q;
    const steps = 420;
    const points: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * turns;
      const k = (big - small) / small;
      points.push([
        cx + (big - small) * Math.cos(t) + d * Math.cos(k * t),
        cy + (big - small) * Math.sin(t) - d * Math.sin(k * t),
      ]);
    }
    rosettes.push(path(points));
  }

  return { waves, rosettes };
}
