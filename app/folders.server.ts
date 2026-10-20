/**
 * The vault drawn as folders, and a selection of it handed over as one ZIP
 * (D41).
 *
 * Nothing here decides who sees what. The tree is built from `VAULT_LIST_SQL`,
 * which reads through the read policies; the ZIP is built from files read
 * through `document_files_read` in the caller's transaction. A document the
 * caller cannot see is not in the tree, and asking for it by id refuses the
 * whole download without saying which id it was.
 *
 * Nothing in this module logs. Paths in the ZIP are owner names and titles.
 */

import { sql } from "drizzle-orm";
import { zipSync } from "fflate";

import { ACTIONS, record } from "./activity.server";
import type { VaultTransaction } from "./db.server";
import { categoryName } from "./documents";
import { downloadName, readFileContents, safeName } from "./download.server";
import { VAULT_LIST_SQL } from "./vault.server";

export type FolderDocument = {
  id: string;
  title: string;
  versionNo: number;
  isCurrent: boolean;
  fileCount: number;
  /** Whether every page is a PDF (D39); an older paper may still be images. */
  isPdf: boolean;
};

/** Owner, then category, then papers; earlier versions apart, as a folder of their own. */
export type Folder = {
  owner: string;
  categories: { category: string; current: FolderDocument[]; earlier: FolderDocument[] }[];
};

/** For a document reached by grant without its owner (D17): no name to file it under. */
export const SHARED = "Shared with me";

type Row = {
  id: string;
  title: string;
  category: string;
  ownerName: string | null;
  versionNo: number;
  isCurrent: boolean;
  fileCount: number;
  isPdf: boolean;
};

/** The tree the caller may see, read through the policies. */
export async function folderTree(db: VaultTransaction): Promise<Folder[]> {
  const rows = await db.execute<Row>(sql`
    select v.*, not exists (
      select 1 from document_files f where f.document_id = v.id and f.mime <> 'application/pdf'
    ) as "isPdf"
    from (${sql.raw(VAULT_LIST_SQL)}) v
  `);
  return buildTree([...rows]);
}

export function buildTree(rows: Row[]): Folder[] {
  const owners = new Map<string, Map<string, { current: FolderDocument[]; earlier: FolderDocument[] }>>();
  for (const row of rows) {
    if (row.fileCount === 0) continue;
    const owner = row.ownerName ?? SHARED;
    const categories = owners.get(owner) ?? new Map();
    owners.set(owner, categories);
    const folder = categories.get(row.category) ?? { current: [], earlier: [] };
    categories.set(row.category, folder);
    const doc = { id: row.id, title: row.title, versionNo: row.versionNo, isCurrent: row.isCurrent, fileCount: row.fileCount, isPdf: row.isPdf };
    (row.isCurrent ? folder.current : folder.earlier).push(doc);
  }

  const byName = (a: string, b: string) => (a === SHARED ? 1 : b === SHARED ? -1 : a.localeCompare(b));
  return [...owners.keys()].sort(byName).map((owner) => ({
    owner,
    categories: [...owners.get(owner)!.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, folder]) => ({ category, ...folder })),
  }));
}

type File = {
  id: string;
  mime: string;
  byteSize: number;
  sha256: string;
  pageNo: number;
  title: string;
  storageKey: string;
  wrappedDek: Buffer;
  nonce: Buffer;
  ownerName: string | null;
  category: string;
  versionNo: number;
  isCurrent: boolean;
};

/**
 * Where each file sits in the ZIP: `Owner/Category/Title.pdf`, an earlier
 * version under `Earlier versions/` with its number, and two files that would
 * land on the same path told apart by a counter, never overwritten.
 */
export function zipPaths(files: Pick<File, "id" | "mime" | "pageNo" | "title" | "ownerName" | "category" | "versionNo" | "isCurrent">[]): Map<string, string> {
  const paths = new Map<string, string>();
  const taken = new Set<string>();
  for (const file of files) {
    const title = file.isCurrent ? file.title : `${file.title} version ${file.versionNo}`;
    const folder = [safeName(file.ownerName ?? SHARED), categoryName(file.category), ...(file.isCurrent ? [] : ["Earlier versions"])].join("/");
    const name = downloadName({ ...file, title, byteSize: 0, sha256: "" });
    let path = `${folder}/${name}`;
    for (let n = 2; taken.has(path.toLowerCase()); n++) {
      path = `${folder}/${name.replace(/(\.[a-z]+)$/, ` (${n})$1`)}`;
    }
    taken.add(path.toLowerCase());
    paths.set(file.id, path);
  }
  return paths;
}

/** What one download may weigh. A whole household vault is far under it. */
export const MAX_ZIP_BYTES = 500 * 1024 * 1024;

export class DownloadRefused extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The chosen documents, every page of each, as one ZIP.
 *
 * Every document asked for must come back through the policies, or nothing is
 * returned: a partial ZIP would tell the asker which of their ids were real.
 * One `document.downloaded` line per file goes in before the bytes are read,
 * in the same transaction, so a download that could not be recorded does not
 * happen.
 *
 * ponytail: built in memory, under `MAX_ZIP_BYTES`. Stream it if a household
 * ever needs more in one go.
 */
export async function zipDocuments(db: VaultTransaction, documentIds: string[]): Promise<Uint8Array> {
  const ids = [...new Set(documentIds)];
  if (ids.length === 0) throw new DownloadRefused("Choose something to download.");
  if (!ids.every((id) => UUID.test(id))) throw new Response("No such document.", { status: 404 });

  const found = await db.execute<{ id: string }>(sql`
    select id from documents where id = any(${`{${ids.join(",")}}`}::uuid[])
  `);
  if (found.length !== ids.length) throw new Response("No such document.", { status: 404 });

  const files = [
    ...(await db.execute<File>(sql`
      select f.id, f.mime, f.byte_size as "byteSize", f.sha256, f.page_no as "pageNo",
             f.storage_key as "storageKey", f.wrapped_dek as "wrappedDek", f.nonce,
             r.title, o.display_name as "ownerName", r.category,
             d.version_no as "versionNo", d.is_current as "isCurrent"
      from document_files f
      join documents d on d.id = f.document_id
      join records r on r.id = d.record_id
      left join owners o on o.id = r.owner_id
      where d.id = any(${`{${ids.join(",")}}`}::uuid[])
      order by o.display_name, r.category, r.title, d.version_no desc, f.page_no
    `)),
  ];

  if (files.reduce((sum, f) => sum + f.byteSize, 0) > MAX_ZIP_BYTES) {
    throw new DownloadRefused(`That is more than ${MAX_ZIP_BYTES / 1024 / 1024} MB. Choose fewer at a time.`);
  }

  for (const file of files) {
    await record(db, { action: ACTIONS.documentDownloaded, subjectType: "document_file", subjectId: file.id });
  }

  const paths = zipPaths(files);
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const file of files) {
    // Stored, not deflated: PDFs and photos are compressed already.
    entries[paths.get(file.id)!] = [new Uint8Array(await readFileContents(file)), { level: 0 }];
  }
  return zipSync(entries);
}
