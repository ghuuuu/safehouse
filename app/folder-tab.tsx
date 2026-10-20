/**
 * The category inks (app.css, `--cat-*`): a section head over a list of
 * papers, and a small mark beside a category's name. Colour is never the only
 * cue; the name is always written beside it.
 */

const colour = (category: string) => `var(--cat-${category})`;

/** A category's section head: its ink as a rule above, its name in that ink. */
export function FolderTab({ category, children }: { category: string; children: React.ReactNode }) {
  return (
    <h2
      className="flex items-baseline gap-3 border-t-2 pt-2 text-base font-semibold capitalize"
      style={{ borderTopColor: colour(category), color: colour(category) }}
    >
      {children}
    </h2>
  );
}

/** A category's mark: a small engraved diamond in its ink. */
export function CategoryMark({ category }: { category: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rotate-45 border-[1.5px]"
      style={{ borderColor: colour(category), backgroundColor: `color-mix(in oklab, ${colour(category)} 25%, transparent)` }}
    />
  );
}
