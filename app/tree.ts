/**
 * The family tree's shapes, shared by the server and the drawing.
 *
 * Not `.server`, because the component and the layout import these, and a
 * component that imports a `.server` module drags the database into the
 * browser bundle (see `app/people.ts`).
 */

export type TreePerson = {
  ownerId: string;
  name: string;
  deceased: boolean;
  /** Null when nobody recorded it. */
  sex: "female" | "male" | null;
  /** How many records the vault would list for them, to this viewer. */
  papers: number;
};

export type TreeEdge = {
  /** For `parent_of`, the parent. A spouse edge is stored once, either way round. */
  from: string;
  to: string;
  kind: "parent_of" | "spouse_of";
  parentType: "biological" | "adoptive" | "step" | "guardian" | null;
  /** A divorce, or a guardianship that ran out. Drawn greyed, not hidden (D33). */
  ended: boolean;
};

export type OwnerLink = { ownerId: string; name: string; papers: number };

export type FamilyTree = {
  people: TreePerson[];
  edges: TreeEdge[];
  businesses: OwnerLink[];
  households: OwnerLink[];
};
