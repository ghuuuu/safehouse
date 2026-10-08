import { Form, Link, useFetcher } from "react-router";

import type { Route } from "./+types/record.$documentId";
import { ACTIONS, record as logEvent } from "../activity.server";
import { findFile, readFileContents } from "../download.server";
import { readDocument } from "../ocr.server";
import {
  EDITABLE_FIELDS,
  findRecordView,
  revealIdentifier,
  saveExtraction,
  saveFields,
  saveProposals,
} from "../record.server";
import { withVault } from "../session.server";
import { requireStepUp } from "../stepup.server";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.view.title} — Safehouse` : "Safehouse" }];
}

/**
 * How this surface enforces access.
 *
 * The queries behind `findRecordView` carry no permission logic. They select
 * from documents, records, owners, subcategories and document_files, every one
 * of which has row-level security, so a document this person may not see
 * produces no row and the page is a 404 — indistinguishable from a document
 * that was never there, which is the correct amount to reveal.
 *
 * The passport number is not in the payload this loader returns. Not masked,
 * not starred out: absent (CLAUDE.md). The page is told whether a number is on
 * file and nothing more. Asking for it is a separate request that costs a
 * password check and a line in the activity log, and the log line is written
 * first, in the same transaction, so a reveal that could not be recorded does
 * not happen (D14).
 *
 * Edits go through `withVault`, never the viewed vault, and the update policy
 * re-checks the document against the same predicate on the way in.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withVault(request, async (db) => {
    const view = await findRecordView(db, params.documentId);

    if (!view) {
      throw new Response("No such document.", { status: 404 });
    }

    return { view };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  if (intent === "reveal") {
    return withVault(request, async (db, user) => {
      await requireStepUp(request, user);
      return { revealed: await revealIdentifier(db, params.documentId) };
    });
  }

  if (intent === "read") {
    return withVault(request, async (db) => {
      const view = await findRecordView(db, params.documentId);
      const first = view?.pages[0];

      if (!first) {
        return { read: "There is nothing scanned behind this one to read." };
      }

      const row = await findFile(db, first.id);
      if (!row) return { read: "That page could not be opened." };

      // Logged before anything is decrypted, in the same transaction, like
      // every other time this vault opens a document (D14).
      await logEvent(db, {
        action: ACTIONS.documentRead,
        subjectType: "document",
        subjectId: params.documentId,
      });

      const bytes = await readFileContents(row);
      const result = await readDocument(bytes, row.mime);
      const saved = await saveProposals(db, params.documentId, result.proposals);

      if (result.terms) {
        await saveExtraction(db, params.documentId, result.terms);
      }

      const kept = saved.keptBecauseConfirmed.length
        ? " Left alone what you had already confirmed."
        : "";
      const filled = saved.written.length
        ? "Filled in " + saved.written.length + " field(s), unconfirmed."
        : "Nothing new to fill in.";

      return { read: result.how + " " + filled + kept };
    });
  }

  const values = Object.fromEntries(
    EDITABLE_FIELDS.filter((field) => form.has(field)).map((field) => [
      field,
      String(form.get(field) ?? ""),
    ]),
  );

  await withVault(request, (db) => saveFields(db, params.documentId, values));

  return { saved: true };
}

const LABELS: Record<string, string> = {
  document_date: "Dated",
  issued_on: "Issued",
  expires_on: "Expires",
  issuer_country: "Issued by",
  place_of_issue: "Place of issue",
  original_location_note: "The original is kept",
};

const DATES = new Set(["document_date", "issued_on", "expires_on"]);

export default function RecordScreen({ loaderData, actionData }: Route.ComponentProps) {
  const { view } = loaderData;
  const reveal = useFetcher<{ revealed: string | null }>();

  // The reader's notes, which are notes and not facts about the world: the
  // vault quotes them and never asserts them (D28).
  const extraction = view.extraction as {
    facts?: { label: string; value: string; page: number }[];
    signposts?: { heading: string; page: number }[];
  };
  const facts = extraction.facts ?? [];
  const signposts = extraction.signposts ?? [];

  const values: Record<string, string | null> = {
    document_date: view.document.documentDate,
    issued_on: view.document.issuedOn,
    expires_on: view.document.expiresOn,
    issuer_country: view.document.issuerCountry,
    place_of_issue: view.document.placeOfIssue,
    original_location_note: view.document.originalLocationNote,
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">{view.title}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {view.ownerName ?? "owner not shown to you"} · {view.category}
          {view.subcategory ? ` · ${view.subcategory}` : ""}
          {view.isPrivate ? " · private" : ""}
          {view.document.isCurrent ? "" : ` · superseded (v${view.document.versionNo})`}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Pages
        </h2>
        {view.pages.length === 0 ? (
          <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600">
            Nothing scanned behind this one yet.
          </p>
        ) : (
          <ul className="rounded-lg border border-gray-200 text-sm">
            {view.pages.map((page) => (
              <li
                key={page.id}
                className="flex items-baseline justify-between gap-2 border-b border-gray-100 p-4 last:border-b-0"
              >
                <span>Page {page.pageNo}</span>
                <span className="flex gap-3 text-xs text-gray-500">
                  <span>{Math.max(1, Math.round(page.byteSize / 1024))} KB</span>
                  <Link className="underline" to={`/file/${page.id}`} reloadDocument>
                    open
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          What it says
        </h2>

        <Form method="post" className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
          {Object.entries(LABELS).map(([field, label]) => (
            <label key={field} className="flex flex-col gap-1 text-sm">
              <span className="flex items-baseline gap-2">
                {label}
                {view.document.confirmedFields.includes(field) ? null : values[field] ? (
                  // Step 8 will put values here that nobody has agreed with yet.
                  <em className="text-xs not-italic text-amber-700 dark:text-amber-400">
                    unconfirmed
                  </em>
                ) : null}
              </span>
              <input
                name={field}
                type={DATES.has(field) ? "date" : "text"}
                defaultValue={values[field] ?? ""}
                className="rounded-lg border border-gray-300 p-2"
              />
            </label>
          ))}

          <div className="flex items-baseline gap-3 text-sm">
            <span>Number</span>
            {reveal.data?.revealed ? (
              <code className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">
                {reveal.data.revealed}
              </code>
            ) : view.document.hasIdentifier ? (
              <>
                <span className="text-gray-500">•••••••• on file</span>
                {/* A button, not a form: this sits inside the fields' form, and a
                    form inside a form is invalid HTML that broke hydration. */}
                <button
                  type="button"
                  className="underline"
                  onClick={() => reveal.submit({ intent: "reveal" }, { method: "post" })}
                >
                  {reveal.state === "submitting" ? "checking…" : "reveal"}
                </button>
              </>
            ) : (
              <span className="text-gray-500">none recorded</span>
            )}
          </div>

          {actionData && "saved" in actionData ? (
            <p className="text-sm text-gray-500">Saved.</p>
          ) : null}
          {actionData && "read" in actionData ? (
            <p className="text-sm text-gray-500">{actionData.read}</p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white"
            >
              Save
            </button>
            <button
              type="submit"
              name="intent"
              value="read"
              className="text-sm text-gray-500 underline"
            >
              Read it from the scan
            </button>
          </div>
        </Form>
      </section>

      {facts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
            What your insurer wrote
          </h2>
          <p className="text-xs text-gray-500">
            Quoted exactly, with their own wording and the page. Nothing here is
            added up or interpreted — where a policy states several figures, all
            of them are shown.
          </p>
          <ul className="rounded-lg border border-gray-200 text-sm">
            {facts.map((fact, index) => (
              <li
                key={`${fact.label}-${index}`}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 p-3 last:border-b-0"
              >
                <span>
                  <span className="text-gray-500">{fact.label}</span>{" "}
                  <strong className="font-medium">{fact.value}</strong>
                </span>
                <span className="text-xs text-gray-500">page {fact.page}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {signposts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Where the conditions are
          </h2>
          <p className="text-xs text-gray-500">
            Headings found in the document. Safehouse does not read these for
            you — it tells you which page to turn to.
          </p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {signposts.map((signpost, index) => (
              <li
                key={`${signpost.heading}-${index}`}
                className="rounded-lg border border-gray-200 px-3 py-2"
              >
                {signpost.heading}
                <span className="ml-2 text-xs text-gray-500">p. {signpost.page}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.versions.length > 1 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Versions
          </h2>
          <ul className="rounded-lg border border-gray-200 text-sm">
            {view.versions.map((version) => (
              <li
                key={version.id}
                className="flex items-baseline justify-between gap-2 border-b border-gray-100 p-4 last:border-b-0"
              >
                <Link
                  className={version.id === view.document.id ? "font-medium" : "underline"}
                  to={`/record/${version.id}`}
                >
                  Version {version.versionNo}
                  {version.isCurrent ? " (current)" : ""}
                </Link>
                <span className="text-xs text-gray-500">
                  {version.pageCount} {version.pageCount === 1 ? "page" : "pages"}
                  {version.expiresOn ? ` · expired ${version.expiresOn}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link className="text-sm text-gray-500 underline" to="/vault">
        Back to the vault
      </Link>
    </main>
  );
}
