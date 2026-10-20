/**
 * Facts about documents that both sides of the wire need.
 *
 * Deliberately not `.server`: the upload form renders the category list and
 * the size ceiling, and a form that disagreed with the server about either
 * would refuse people for reasons the page never mentioned. The enforcement
 * still happens on the server (`upload.server.ts`) — this is the one copy of
 * the numbers, not a second opinion.
 */

/** PRODUCT.md §Taxonomy. The database has the same six as an enum. */
export const CATEGORIES = [
  "personal",
  "medical",
  "business",
  "financial",
  "legal",
  "general",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** "Personal", from the enum. */
export const categoryName = (category: string) => category[0].toUpperCase() + category.slice(1);

/**
 * What a document is called when nobody said. Never the file's own name, which
 * is not stored anywhere (`upload.server.ts`): "maya-passport-X1234567.pdf" is
 * a field value wearing a file name.
 */
export function untitled(category: Category): string {
  return `${category[0].toUpperCase()}${category.slice(1)} document`;
}

/**
 * Twenty-five megabytes. A scanned passport page is under one; a long contract
 * scanned at high resolution is a few. Sealing buffers the whole file in
 * memory, so this is also the ceiling on what one upload costs the server.
 *
 * ponytail: whole-file buffering, fine for documents. Stream through a cipher
 * if video ever becomes a thing this holds.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * What a household vault is for. Everything else is refused by name, including
 * the office formats — a vault that will hold anything is a place to park
 * malware for somebody else to open.
 *
 * Not HEIC: every upload becomes a PDF (D39), and the image library here
 * cannot decode HEVC. Leaving it out is also what makes an iPhone send a JPEG
 * instead, since the picker converts when the page does not ask for HEIC.
 */
export const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
] as const;
