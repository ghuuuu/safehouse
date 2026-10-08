/**
 * The category colours (app.css, `--cat-*`): a folder tab over a list of
 * papers, and a small mark beside a category's name. Colour is never the only
 * cue; the name is always written beside it.
 */

const colour = (category: string) => `var(--cat-${category})`;

export function FolderTab({ category, children }: { category: string; children: React.ReactNode }) {
  return (
    <h2
      className="self-start rounded-t-md border border-b-0 border-t-[3px] border-gray-200 px-3 py-1 text-sm font-medium capitalize"
      style={{
        borderTopColor: colour(category),
        backgroundColor: `color-mix(in oklab, ${colour(category)} 12%, var(--sheet))`,
      }}
    >
      {children}
    </h2>
  );
}

export function CategoryMark({ category }: { category: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colour(category) }} />;
}
