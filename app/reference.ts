/**
 * A paper's printed reference, "PER-3F9A-21C0": its category, then eight hex
 * digits hashed from its id.
 *
 * Taken from the document's id and nothing else. A running number would say
 * how many papers exist beyond the ones the viewer can see; a hash of the id
 * says nothing but which paper this is, and stays the same for its life.
 */

const PREFIX: Record<string, string> = {
  personal: "PER",
  medical: "MED",
  business: "BUS",
  financial: "FIN",
  legal: "LEG",
  general: "GEN",
};

export function reference(category: string, documentId: string): string {
  // FNV-1a, twice with different offsets, for eight well-spread hex digits.
  const fnv = (offset: number) => {
    let h = offset;
    for (let i = 0; i < documentId.length; i++) {
      h ^= documentId.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
  };
  const a = fnv(0x811c9dc5);
  const b = fnv(0x050c5d1f);
  return `${PREFIX[category] ?? "DOC"}-${a.slice(0, 4)}-${b.slice(4, 8)}`;
}
