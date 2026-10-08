/**
 * The dashboard's mode switch, shared by the server and the page.
 *
 * Not `.server`: the page renders the switch from this list, and a component
 * that imports a `.server` module cannot be bundled for the browser.
 */

export const MODES = ["individuals", "businesses"] as const;
export type Mode = (typeof MODES)[number];
