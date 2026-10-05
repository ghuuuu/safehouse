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
 */
export const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
] as const;
