import { useEffect, useRef, useState } from "react";
import { Form, Link } from "react-router";

import type { Route } from "./+types/folders";
import { categoryName } from "../documents";
import { type Folder, type FolderDocument, folderTree } from "../folders.server";
import { Masthead, Page } from "../masthead";
import { withVault } from "../session.server";

export function meta() {
  return [{ title: "Folders — Safehouse" }];
}

/**
 * The vault as folders: whose, then what kind, then the papers (D41).
 *
 * How this surface enforces access: the tree is `VAULT_LIST_SQL` under the
 * read policies (`folderTree`), so it holds exactly what the vault list
 * holds for this person and nothing more. Downloading posts the chosen ids to
 * `/folders/download`, which asks for the password and reads every one of
 * them through the policies again.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return withVault(request, async (db) => ({
    folders: await folderTree(db),
    refused: url.searchParams.get("refused"),
    confirmed: url.searchParams.has("confirmed"),
  }));
}

const idsOf = (folder: Folder) => folder.categories.flatMap((c) => [...c.current, ...c.earlier].map((d) => d.id));

export default function Folders({ loaderData }: Route.ComponentProps) {
  const { folders, refused, confirmed } = loaderData;
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const all = folders.flatMap(idsOf);
  const papers = folders.flatMap((f) => f.categories.flatMap((c) => c.current)).length;

  const toggle = (ids: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  return (
    <>
      <Masthead title="Folders" serial={`${folders.length} ${folders.length === 1 ? "folder" : "folders"} · ${papers} papers`} />
      <Page narrow>
        <p className="-mb-2 max-w-prose text-base text-gray-700">
          Every paper you can see, filed under whose it is. Tick papers or whole folders and download them as one ZIP,
          laid out the same way.
        </p>

        {refused ? <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">{refused}</p> : null}
        {confirmed ? <p role="status" className="text-sm text-gray-500">Password confirmed. Choose again and download.</p> : null}

        {folders.length === 0 ? (
          <p className="sheet p-5 text-sm text-gray-500">
            Nothing filed that you can see yet. <Link className="underline hover:text-gray-900" to="/upload">File a document</Link>.
          </p>
        ) : (
          <Form method="post" action="/folders/download" reloadDocument className="flex flex-col gap-4">
            <div className="sheet">
              <div className="flex items-center gap-3 border-b border-gray-900 px-4 py-3 md:px-5">
                <Tick ids={all} chosen={chosen} toggle={toggle} label="Everything" />
                <span className="font-semibold">Everything</span>
              </div>
              <ul>
                {folders.map((folder) => (
                  <li key={folder.owner} className="border-b border-gray-200 last:border-b-0">
                    <details open={folders.length <= 3}>
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-gray-50 md:px-5 [&::-webkit-details-marker]:hidden">
                        <Tick ids={idsOf(folder)} chosen={chosen} toggle={toggle} label={folder.owner} />
                        <FolderMark />
                        <span className="font-semibold">{folder.owner}</span>
                        <span className="ml-auto font-mono text-xs text-gray-500">{idsOf(folder).length}</span>
                      </summary>
                      <ul className="pb-2">
                        {folder.categories.map((cat) => (
                          <li key={cat.category}>
                            <details open>
                              <summary className="flex cursor-pointer list-none items-center gap-3 py-2 pl-10 pr-4 hover:bg-gray-50 md:pl-12 md:pr-5 [&::-webkit-details-marker]:hidden">
                                <Tick ids={[...cat.current, ...cat.earlier].map((d) => d.id)} chosen={chosen} toggle={toggle} label={`${folder.owner}, ${categoryName(cat.category)}`} />
                                <FolderMark />
                                <span>{categoryName(cat.category)}</span>
                              </summary>
                              <ul>
                                {cat.current.map((doc) => <Paper key={doc.id} doc={doc} chosen={chosen} toggle={toggle} depth={2} />)}
                                {cat.earlier.length > 0 ? (
                                  <li>
                                    <details>
                                      <summary className="flex cursor-pointer list-none items-center gap-3 py-2 pl-16 pr-4 text-sm text-gray-500 hover:bg-gray-50 md:pl-20 md:pr-5 [&::-webkit-details-marker]:hidden">
                                        <Tick ids={cat.earlier.map((d) => d.id)} chosen={chosen} toggle={toggle} label={`${folder.owner}, ${categoryName(cat.category)}, earlier versions`} />
                                        <FolderMark />
                                        Earlier versions
                                      </summary>
                                      <ul>{cat.earlier.map((doc) => <Paper key={doc.id} doc={doc} chosen={chosen} toggle={toggle} depth={3} />)}</ul>
                                    </details>
                                  </li>
                                ) : null}
                              </ul>
                            </details>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </div>

            {[...chosen].map((id) => <input key={id} type="hidden" name="documentId" value={id} />)}
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" disabled={chosen.size === 0} className="btn btn-primary">
                Download {chosen.size > 0 ? <span className="font-mono">{chosen.size}</span> : null} as ZIP
              </button>
              <p className="text-sm text-gray-500">Asks for your password, as opening any paper does.</p>
            </div>
          </Form>
        )}
      </Page>
    </>
  );
}

/** A folder's or paper's checkbox: ticked when all of it is chosen, half when some is. */
function Tick({ ids, chosen, toggle, label }: { ids: string[]; chosen: Set<string>; toggle: (ids: string[], on: boolean) => void; label: string }) {
  const box = useRef<HTMLInputElement>(null);
  const some = ids.filter((id) => chosen.has(id)).length;
  useEffect(() => {
    if (box.current) box.current.indeterminate = some > 0 && some < ids.length;
  }, [some, ids.length]);
  return (
    <input
      ref={box}
      type="checkbox"
      aria-label={`Choose ${label}`}
      checked={ids.length > 0 && some === ids.length}
      onChange={(e) => toggle(ids, e.target.checked)}
      // A tick in a folder's summary must not also open or close the folder.
      onClick={(e) => e.stopPropagation()}
      className="size-4 shrink-0 pointer-coarse:size-5"
    />
  );
}

function Paper({ doc, chosen, toggle, depth }: { doc: FolderDocument; chosen: Set<string>; toggle: (ids: string[], on: boolean) => void; depth: 2 | 3 }) {
  return (
    <li className={`flex items-center gap-3 py-2 pr-4 md:pr-5 ${depth === 2 ? "pl-16 md:pl-20" : "pl-24 md:pl-28"}`}>
      <Tick ids={[doc.id]} chosen={chosen} toggle={toggle} label={doc.title} />
      <Link to={`/record/${doc.id}`} className="min-w-0 truncate underline-offset-2 hover:underline">
        {doc.title}
        {doc.isCurrent ? "" : <span className="text-gray-500"> (version <span className="font-mono">{doc.versionNo}</span>)</span>}
      </Link>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {doc.isPdf ? null : <span className="stamp stamp-quiet">Image</span>}
        {doc.fileCount > 1 ? <span className="font-mono text-xs text-gray-500">{doc.fileCount} files</span> : null}
      </span>
    </li>
  );
}

/** A folder, drawn in lines like the rest of the print: a tab and a body, no fill. */
function FolderMark() {
  return (
    <svg aria-hidden viewBox="0 0 16 13" className="h-3.5 w-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" strokeWidth={1.25}>
      <path d="M1 2.5V12h14V3.5H7.5L6 1.5H1z" strokeLinejoin="miter" />
    </svg>
  );
}
