/**
 * The vocabulary of the add-member sentence, shared by the form and the server.
 *
 * Separate from `people.server.ts` for a build reason worth knowing: React
 * Router strips `loader` and `action` from the client bundle, but anything a
 * *component* imports goes with it. A select box that reads its options from a
 * `.server` module drags the database into the browser bundle and the build
 * refuses, correctly. Same reason `documents.ts` exists.
 */

export type ParentType = "biological" | "adoptive" | "step" | "guardian";

/** How the new person attaches to somebody already in the tree. */
export type Link =
  | { relation: "child_of"; anchorOwnerId: string; parentType: ParentType }
  | { relation: "parent_of"; anchorOwnerId: string; parentType: ParentType }
  | { relation: "spouse_of"; anchorOwnerId: string }
  | { relation: "sibling_of"; anchorOwnerId: string };

/**
 * The middle of *"___ is the ___ of ___."*
 *
 * Read from the new person's side, which is the side the form is filling in.
 * "Brother or sister of" rather than "sibling of" because nobody says sibling.
 */
export const RELATIONS = [
  { value: "child_of", label: "child of" },
  { value: "parent_of", label: "parent of" },
  { value: "spouse_of", label: "spouse of" },
  { value: "sibling_of", label: "brother or sister of" },
] as const;

export type Sex = "female" | "male";

/** Optional on the form: leaving it blank records nothing (D33). */
export const SEXES: { value: Sex; label: string }[] = [
  { value: "female", label: "female" },
  { value: "male", label: "male" },
];

export const PARENT_TYPES: { value: ParentType; label: string }[] = [
  { value: "biological", label: "biological" },
  { value: "adoptive", label: "adoptive" },
  { value: "step", label: "step" },
  { value: "guardian", label: "guardian" },
];
