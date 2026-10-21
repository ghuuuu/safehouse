/**
 * The category colours (app.css, `--cat-*`): a section head over a list of
 * papers, and a small dot beside a category's name. Colour is never the only
 * cue; the name is always written beside it.
 */

const colour = (category: string) => `var(--cat-${category})`;

/** A category's section head: its dot, then its name. */
export function FolderTab({ category, children }: { category: string; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 text-base font-semibold capitalize text-gray-950">
      <CategoryMark category={category} />
      {children}
    </h2>
  );
}

/** A category's mark: a small dot in its colour, softly ringed. */
export function CategoryMark({ category }: { category: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: colour(category), boxShadow: `0 0 0 3px color-mix(in oklab, ${colour(category)} 18%, transparent)` }}
    />
  );
}
