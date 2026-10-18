import { useState } from "react";
import { Link } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/bulk";
import { ACCEPTED_TYPES, CATEGORIES, MAX_UPLOAD_BYTES, untitled, type Category } from "../documents";
import { Masthead, Page } from "../masthead";
import { withVault } from "../session.server";

export function meta() {
  return [{ title: "File many — Safehouse" }];
}

type OwnerOption = { id: string; displayName: string; kind: string };

/**
 * How this surface enforces access.
 *
 * The owner list is policy-filtered like /upload's, which is presentation. The
 * decision is made per file in `bulk.file.ts`, where `records_write` refuses an
 * owner the filer cannot see. Nothing is sent until every file has an owner
 * and a category, and file names are never sent as titles.
 */
export async function loader({ request }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    const rows = await db.execute<OwnerOption>(sql`
      select id, display_name as "displayName", kind
      from owners
      where archived_at is null
      order by kind, display_name
    `);
    return { owners: [...rows], canFile: user.role === "admin" || user.role === "individual" };
  });
}

type Status = "waiting" | "filing" | "filed" | "refused";

type Row = {
  key: number;
  file: File;
  ownerId: string;
  category: Category;
  title: string;
  status: Status;
  message?: string;
  documentId?: string;
  proposed?: number;
};

const MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

export default function Bulk({ loaderData }: Route.ComponentProps) {
  const { owners, canFile } = loaderData;
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [allOwner, setAllOwner] = useState("");
  const [allCategory, setAllCategory] = useState<Category | "">("");

  const update = (key: number, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const add = (files: FileList | null) => {
    if (!files) return;
    const start = rows.length ? Math.max(...rows.map((r) => r.key)) + 1 : 0;
    setRows([
      ...rows,
      ...[...files].map((file, i) => ({
        key: start + i,
        file,
        ownerId: allOwner,
        category: (allCategory || "general") as Category,
        title: "",
        status: "waiting" as const,
      })),
    ]);
  };

  const waiting = rows.filter((row) => row.status === "waiting" || row.status === "refused");
  const unassigned = waiting.filter((row) => !row.ownerId).length;

  // ponytail: one file at a time. Parallel requests would be faster and would
  // also run several Tesseract reads at once on a small home server.
  const fileAll = async () => {
    setRunning(true);
    for (const row of waiting) {
      update(row.key, { status: "filing", message: undefined });
      const body = new FormData();
      body.append("file", row.file);
      body.append("ownerId", row.ownerId);
      body.append("category", row.category);
      body.append("title", row.title);

      try {
        const response = await fetch("/bulk/file", { method: "POST", body });
        const answer = response.headers.get("content-type")?.includes("json")
          ? await response.json()
          : { error: "Signed out, or the server did not answer. Sign in and try again." };

        if (response.ok && answer.documentId) {
          update(row.key, { status: "filed", documentId: answer.documentId, proposed: answer.proposed, message: answer.how });
        } else {
          update(row.key, { status: "refused", message: answer.error ?? "Not filed." });
        }
      } catch {
        update(row.key, { status: "refused", message: "The connection dropped. Try again." });
      }
    }
    setRunning(false);
  };

  const filed = rows.filter((row) => row.status === "filed").length;
  const refused = rows.filter((row) => row.status === "refused").length;

  if (!canFile) {
    return (
      <>
        <Masthead title="File many" />
        <Page narrow>
          <p className="sheet p-5 text-sm text-gray-500">
            Your account can read the vault but not add to it.
          </p>
        </Page>
      </>
    );
  }

  return (
    <>
      <Masthead title="File many">
        <nav className="flex gap-4 text-sm">
          <Link className="btn btn-serial btn-sm" to="/upload">File one</Link>
        </nav>
      </Masthead>

      <Page>
        <p className="-mb-2 max-w-prose text-base text-gray-700">
          Pick the files, say whose each one is and what kind, then file them. Each is encrypted, filed
          as its own record, and read for dates and numbers on the way in. Up to <span className="font-mono">{MB}</span> MB each, PDF or an image.
        </p>

        <label className="sheet flex flex-col gap-2 p-5 text-sm font-medium md:p-6">
          Files
          <input
            type="file"
            multiple
            disabled={running}
            accept={ACCEPTED_TYPES.join(",")}
            onChange={(event) => {
              add(event.target.files);
              event.target.value = "";
            }}
            className="font-normal"
          />
        </label>

        {rows.length > 0 ? (
          <>
            <fieldset disabled={running} className="sheet flex flex-wrap items-end gap-3 p-4 text-sm md:px-5">
              <legend className="index px-1 text-gray-500">Apply to every file not yet filed</legend>
              <label className="flex flex-col gap-1.5 font-medium">
                Whose
                <select value={allOwner} onChange={(e) => setAllOwner(e.target.value)} className="field w-auto font-normal">
                  <option value="">—</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>{o.displayName}{o.kind === "person" ? "" : ` (${o.kind})`}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 font-medium">
                Kind
                <select value={allCategory} onChange={(e) => setAllCategory(e.target.value as Category)} className="field w-auto font-normal capitalize">
                  <option value="">—</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  setRows((current) =>
                    current.map((row) =>
                      row.status === "filed"
                        ? row
                        : { ...row, ownerId: allOwner || row.ownerId, category: (allCategory || row.category) as Category },
                    ),
                  )
                }
              >
                Apply
              </button>
            </fieldset>

            <div className="sheet overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-900 text-left text-gray-500">
                    <th className="index px-3 pb-2 pt-4 md:pl-5">File (not stored)</th>
                    <th className="index px-3 pb-2 pt-4">Whose</th>
                    <th className="index px-3 pb-2 pt-4">Kind</th>
                    <th className="index px-3 pb-2 pt-4">Called</th>
                    <th className="index px-3 pb-2 pt-4">Outcome</th>
                    <th className="px-3 pb-2 pt-4 md:pr-5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const locked = running || row.status === "filed" || row.status === "filing";
                    return (
                      <tr key={row.key} className="border-b border-gray-200 align-top last:border-b-0">
                        <td className="max-w-48 truncate px-3 py-3 font-semibold md:pl-5" title={row.file.name}>
                          {row.file.name}
                          <span className="block font-mono text-xs font-normal text-gray-500">
                            {Math.max(1, Math.round(row.file.size / 1024))} KB
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <select
                            aria-label={`Whose is ${row.file.name}`}
                            value={row.ownerId}
                            disabled={locked}
                            onChange={(e) => update(row.key, { ownerId: e.target.value })}
                            className="field w-auto"
                          >
                            <option value="">—</option>
                            {owners.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <select
                            aria-label={`What kind is ${row.file.name}`}
                            value={row.category}
                            disabled={locked}
                            onChange={(e) => update(row.key, { category: e.target.value as Category })}
                            className="field w-auto capitalize"
                          >
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            aria-label={`What ${row.file.name} is called`}
                            value={row.title}
                            maxLength={200}
                            disabled={locked}
                            placeholder={untitled(row.category)}
                            onChange={(e) => update(row.key, { title: e.target.value })}
                            className="field w-48"
                          />
                        </td>
                        <td className="px-3 py-3" aria-live="polite">
                          {row.status === "waiting" ? <span className="text-gray-500">not filed yet</span> : null}
                          {row.status === "filing" ? <span>filing and reading…</span> : null}
                          {row.status === "filed" ? (
                            <span className="flex flex-col items-start gap-1.5">
                              <Link className="stamp stamp-quiet hover:text-gray-900" to={`/record/${row.documentId}`}>filed</Link>
                              <span className="block text-xs text-gray-500">
                                {row.proposed ? `${row.proposed} field(s) proposed, unconfirmed` : "nothing read"}
                              </span>
                            </span>
                          ) : null}
                          {row.status === "refused" ? (
                            <span className="flex max-w-64 flex-col items-start gap-1.5">
                              <span className="stamp stamp-warn">Not filed</span>
                              <span className="text-xs text-red-700 dark:text-red-400">{row.message}</span>
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 md:pr-5">
                          {locked ? null : (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                            >
                              remove
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                disabled={running || waiting.length === 0 || unassigned > 0}
                onClick={fileAll}
                className="btn btn-primary"
              >
                {running ? "Filing…" : `File ${waiting.length} ${waiting.length === 1 ? "document" : "documents"}`}
              </button>
              <p className="max-w-prose text-sm text-gray-500" aria-live="polite">
                {unassigned > 0 ? `${unassigned} still need an owner. ` : ""}
                {filed + refused > 0 ? `Filed ${filed}${refused ? `, ${refused} not filed` : ""}.` : ""}
              </p>
            </div>
            <p className="-mt-4 max-w-prose text-xs text-gray-500">
              Dates and numbers the reader finds are proposals: nothing acts on them until somebody confirms them
              on the document&apos;s page.
            </p>
          </>
        ) : null}
      </Page>
    </>
  );
}
