/**
 * The real sizes a page can be drawn at (D39), shared by the server that warps
 * a photo onto one and the review screen that offers the choice.
 *
 * Dimensions are the long and short side in millimetres; which way round a
 * page sits follows the photo, not this table.
 */
export const PAPER_SIZES = {
  id1: { label: "ID card, licence, bank card (85.6 × 54 mm)", long: 85.6, short: 54 },
  id3: { label: "Passport page (125 × 88 mm)", long: 125, short: 88 },
  a5: { label: "A5 (210 × 148 mm)", long: 210, short: 148 },
  a4: { label: "A4 (297 × 210 mm)", long: 297, short: 210 },
  letter: { label: "US Letter (279.4 × 215.9 mm)", long: 279.4, short: 215.9 },
} as const;

export type PaperKey = keyof typeof PAPER_SIZES;

/**
 * What a page's size is: a preset, a size typed in, or "as scanned", which
 * takes a flatbed scan at the resolution it recorded and does not crop it.
 */
export type PaperSize = PaperKey | "scanned" | { w: number; h: number };

/**
 * Presets whose shape is within 3% of a measured outline. More than one is
 * normal: A4, A5 and a passport page are all close to √2, so the outline alone
 * never decides between them and the reviewer (or a passport's own MRZ) does.
 */
export function sizesShaped(width: number, height: number): PaperKey[] {
  const ratio = Math.max(width, height) / Math.min(width, height);
  return (Object.keys(PAPER_SIZES) as PaperKey[]).filter((key) => {
    const size = PAPER_SIZES[key];
    return Math.abs(ratio / (size.long / size.short) - 1) <= 0.03;
  });
}

/** Millimetres to PDF points. */
export const mmToPt = (mm: number) => (mm * 72) / 25.4;
