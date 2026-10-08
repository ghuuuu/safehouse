import { useState } from "react";
import { Link } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/bulk";
import { ACCEPTED_TYPES, CATEGORIES, MAX_UPLOAD_BYTES, untitled, type Category } from "../documents";
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
      <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-8">
        <h1 className="text-2xl font-medium tracking-tight">File many</h1>
        <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600">
          Your account can read the vault but not add to it.
        </p>
        <Link className="text-sm underline" to="/">Home</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">File many</h1>
          <p className="mt-1 text-sm text-gray-500">
            Pick the files, say whose each one is and what kind, then file them. Each is encrypted, filed
            as its own record, and read for dates and numbers on the way in. Up to {MB} MB each, PDF or an image.
          </p>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link className="underline" to="/">Home</Link>
          <Link className="underline" to="/upload">File one</Link>
        </nav>
      </div>

      <label className="flex flex-col gap-1 text-sm">
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
          className="rounded-lg border border-gray-300 p-2"
        />
      </label>

      {rows.length > 0 ? (
        <>
          <fieldset disabled={running} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-4 text-sm">
            <legend className="px-1 text-gray-500">Apply to every file not yet filed</legend>
            <label className="flex flex-col gap-1">
              Whose
              <select value={allOwner} onChange={(e) => setAllOwner(e.target.value)} className="rounded border border-gray-300 p-1.5">
                <option value="">—</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.displayName}{o.kind === "person" ? "" : ` (${o.kind})`}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Kind
              <select value={allCategory} onChange={(e) => setAllCategory(e.target.value as Category)} className="rounded border border-gray-300 p-1.5">
                <option value="">—</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-1.5"
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

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="p-2 font-normal">File (not stored)</th>
                  <th className="p-2 font-normal">Whose</th>
                  <th className="p-2 font-normal">Kind</th>
                  <th className="p-2 font-normal">Called</th>
                  <th className="p-2 font-normal">Outcome</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const locked = running || row.status === "filed" || row.status === "filing";
                  return (
                    <tr key={row.key} className="border-b border-gray-100 align-top">
                      <td className="max-w-48 truncate p-2 text-gray-500" title={row.file.name}>
                        {row.file.name}
                        <span className="block text-xs">{Math.max(1, Math.round(row.file.size / 1024))} KB</span>
                      </td>
                      <td className="p-2">
                        <select
                          aria-label={`Whose is ${row.file.name}`}
                          value={row.ownerId}
                          disabled={locked}
                          onChange={(e) => update(row.key, { ownerId: e.target.value })}
                          className="rounded border border-gray-300 p-1.5"
                        >
                          <option value="">—</option>
                          {owners.map((o) => <option key={o.id} value={o.id}>{o.displayName}</option>)}
                        </select>
                      </td>
                      <td className="p-2">
                        <select
                          aria-label={`What kind is ${row.file.name}`}
                          value={row.category}
                          disabled={locked}
                          onChange={(e) => update(row.key, { category: e.target.value as Category })}
                          className="rounded border border-gray-300 p-1.5"
                        >
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          aria-label={`What ${row.file.name} is called`}
                          value={row.title}
                          maxLength={200}
                          disabled={locked}
                          placeholder={untitled(row.category)}
                          onChange={(e) => update(row.key, { title: e.target.value })}
                          className="w-48 rounded border border-gray-300 p-1.5"
                        />
                      </td>
                      <td className="p-2" aria-live="polite">
                        {row.status === "waiting" ? <span className="text-gray-500">not filed yet</span> : null}
                        {row.status === "filing" ? <span>filing and reading…</span> : null}
                        {row.status === "filed" ? (
                          <span>
                            <Link className="underline" to={`/record/${row.documentId}`}>filed</Link>
                            <span className="block text-xs text-gray-500">
                              {row.proposed ? `${row.proposed} field(s) proposed, unconfirmed` : "nothing read"}
                            </span>
                          </span>
                        ) : null}
                        {row.status === "refused" ? <span className="text-red-700">{row.message}</span> : null}
                      </td>
                      <td className="p-2">
                        {locked ? null : (
                          <button
                            type="button"
                            className="text-gray-500 underline"
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
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {running ? "Filing…" : `File ${waiting.length} ${waiting.length === 1 ? "document" : "documents"}`}
            </button>
            <p className="text-sm text-gray-500" aria-live="polite">
              {unassigned > 0 ? `${unassigned} still need an owner. ` : ""}
              {filed + refused > 0 ? `Filed ${filed}${refused ? `, ${refused} not filed` : ""}.` : ""}
            </p>
          </div>
          <p className="text-xs text-gray-500">
            Dates and numbers the reader finds are proposals: nothing acts on them until somebody confirms them
            on the document&apos;s page.
          </p>
        </>
      ) : null}
    </main>
  );
}
