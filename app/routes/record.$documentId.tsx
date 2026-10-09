import { Form, Link, redirect, useFetcher, useNavigation } from "react-router";

import type { Route } from "./+types/record.$documentId";
import { ACTIONS, record as logEvent } from "../activity.server";
import { findFile, readFileContents } from "../download.server";
import { CategoryMark } from "../folder-tab";
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
import { longDate } from "../when";

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
 * re-checks the document against the same predicate on the way in. `canEdit`
 * only decides whether to offer the Edit button; a third party who posts the
 * form anyway changes nothing, and is told so.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);

  return withVault(request, async (db, user) => {
    const view = await findRecordView(db, params.documentId);

    if (!view) {
      throw new Response("No such document.", { status: 404 });
    }

    // The same roles `documents_update` lets through (0007, may_file).
    const canEdit = user.role === "admin" || user.role === "individual";

    return {
      view,
      canEdit,
      editing: canEdit && url.searchParams.has("edit"),
      saved: url.searchParams.has("saved"),
    };
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

  const changed = await withVault(request, (db) => saveFields(db, params.documentId, values));
  if (!changed) return { error: "You can read this document but not change it." };

  // Back to reading, so what was just saved is what is shown.
  return redirect(`/record/${params.documentId}?saved`);
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
  const { view, canEdit, editing, saved } = loaderData;
  const here = `/record/${view.document.id}`;

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
  const unconfirmed = Object.keys(LABELS).filter(
    (field) => values[field] && !view.document.confirmedFields.includes(field),
  );
  const current = view.versions.find((version) => version.isCurrent);
  const expired = view.versions.find((version) => version.id === view.document.id)?.expired ?? false;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{view.title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-gray-500">
          {view.ownerName ?? "owner not shown to you"} ·
          <CategoryMark category={view.category} />
          <span className="capitalize">{view.category}</span>
          {view.subcategory ? ` · ${view.subcategory}` : ""}
          {view.isPrivate ? " · private" : ""}
        </p>
        {!view.document.isCurrent && current ? (
          <p className="mt-3 text-sm">
            This is an older version (version {view.document.versionNo}).{" "}
            <Link className="underline" to={`/record/${current.id}`}>
              See the current one
            </Link>
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-base font-medium">What it says</h2>
          {canEdit && !editing ? (
            <Link className="rounded-full border border-gray-300 bg-white hover:border-gray-500 px-3 py-1.5 text-sm" to={`${here}?edit`}>
              Edit
            </Link>
          ) : null}
        </div>

        {saved && !editing ? <p role="status" className="text-sm text-gray-500">Saved.</p> : null}

        {editing ? (
          <EditDetails
            values={values}
            confirmed={view.document.confirmedFields}
            cancel={here}
            hasPages={view.pages.length > 0}
            message={actionData && "read" in actionData ? actionData.read : null}
            error={actionData && "error" in actionData ? actionData.error : null}
          />
        ) : (
          <>
            {unconfirmed.length > 0 ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                {unconfirmed.length === 1 ? "One detail was" : `${unconfirmed.length} details were`} read from the scan
                and nobody has checked {unconfirmed.length === 1 ? "it" : "them"} yet.{" "}
                {canEdit ? (
                  <Link className="underline" to={`${here}?edit`}>
                    Check {unconfirmed.length === 1 ? "it" : "them"}
                  </Link>
                ) : null}
              </p>
            ) : null}

            <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
              {Object.entries(LABELS).map(([field, label]) => {
                const value = values[field];
                return (
                  <div key={field} className="flex flex-col gap-0.5 px-4 py-3 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="flex flex-wrap items-baseline gap-x-2">
                      {value ? (
                        <span className="font-medium">{DATES.has(field) ? longDate(value) : value}</span>
                      ) : (
                        <span className="text-gray-500">Not recorded</span>
                      )}
                      {field === "expires_on" && value && expired ? (
                        <span className="text-xs font-medium text-red-700 dark:text-red-400">expired</span>
                      ) : null}
                      {value && unconfirmed.includes(field) ? (
                        <span className="text-xs text-amber-700 dark:text-amber-400">unconfirmed</span>
                      ) : null}
                    </dd>
                  </div>
                );
              })}
              <div className="flex flex-col gap-0.5 px-4 py-3 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4">
                <dt className="text-gray-500">Number</dt>
                <dd>
                  <MaskedNumber hasIdentifier={view.document.hasIdentifier} />
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Pages</h2>
        {view.pages.length === 0 ? (
          <p className="rounded-lg border border-gray-200 p-4 text-sm text-gray-600">
            Nothing scanned behind this one yet.
          </p>
        ) : (
          <ul className="rounded-lg border border-gray-200 bg-white text-sm">
            {view.pages.map((page) => (
              <li
                key={page.id}
                className="relative flex items-baseline justify-between gap-2 border-b border-gray-100 p-4 last:border-b-0"
              >
                <span>Page {page.pageNo}</span>
                <span className="flex gap-3 text-xs text-gray-500">
                  <span>{Math.max(1, Math.round(page.byteSize / 1024))} KB</span>
                  <Link className="row-link underline" to={`/file/${page.id}`} reloadDocument>
                    open
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {facts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">What your insurer wrote</h2>
          <p className="text-xs text-gray-500 max-w-prose">
            Quoted exactly, with their own wording and the page. Nothing here is
            added up or interpreted — where a policy states several figures, all
            of them are shown.
          </p>
          <ul className="rounded-lg border border-gray-200 bg-white text-sm">
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
          <h2 className="text-base font-medium">Where the conditions are</h2>
          <p className="text-xs text-gray-500 max-w-prose">
            Headings found in the document. Safehouse does not read these for
            you — it tells you which page to turn to.
          </p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {signposts.map((signpost, index) => (
              <li
                key={`${signpost.heading}-${index}`}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2"
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
          <h2 className="text-base font-medium">Versions</h2>
          <ul className="rounded-lg border border-gray-200 bg-white text-sm">
            {view.versions.map((version) => (
              <li
                key={version.id}
                className="relative flex items-baseline justify-between gap-2 border-b border-gray-100 p-4 last:border-b-0"
              >
                <Link
                  className={"row-link " + (version.id === view.document.id ? "font-medium" : "underline")}
                  to={`/record/${version.id}`}
                >
                  Version {version.versionNo}
                  {version.isCurrent ? " (current)" : ""}
                </Link>
                <span className="text-xs text-gray-500">
                  {version.pageCount} {version.pageCount === 1 ? "page" : "pages"}
                  {version.expiresOn ? ` · ${version.expired ? "expired" : "expires"} ${longDate(version.expiresOn)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link className="self-start py-2 text-sm text-gray-500 underline" to="/vault">
        Back to the vault
      </Link>
    </main>
  );
}

/** The masked number, and the step-up reveal (D14, D35). Its own request, never the page's. */
function MaskedNumber({ hasIdentifier }: { hasIdentifier: boolean }) {
  const reveal = useFetcher<{ revealed: string | null }>();

  if (reveal.data?.revealed) {
    return <code className="rounded bg-gray-100 px-2 py-1">{reveal.data.revealed}</code>;
  }
  if (!hasIdentifier) return <span className="text-gray-500">Not recorded</span>;

  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-gray-500">•••••••• on file</span>
      <button
        type="button"
        className="-my-2 px-1 py-2 underline"
        onClick={() => reveal.submit({ intent: "reveal" }, { method: "post" })}
      >
        {reveal.state === "submitting" ? "checking…" : "reveal"}
      </button>
    </span>
  );
}

function EditDetails({
  values,
  confirmed,
  cancel,
  hasPages,
  message,
  error,
}: {
  values: Record<string, string | null>;
  confirmed: string[];
  cancel: string;
  hasPages: boolean;
  message: string | null;
  error: string | null;
}) {
  const busy = useNavigation().state !== "idle";

  return (
    // Keyed on the values, so a read from the scan that filled fields in
    // shows them rather than what the inputs held before.
    <Form
      key={JSON.stringify(values)}
      method="post"
      className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
    >
      <p className="text-sm text-gray-500 max-w-prose">
        Saving confirms every detail left filled in. Clear anything that is wrong rather than leave it.
      </p>

      {Object.entries(LABELS).map(([field, label]) => (
        <label key={field} className="flex flex-col gap-1 text-sm">
          <span className="flex items-baseline gap-2">
            {label}
            {values[field] && !confirmed.includes(field) ? (
              <em className="text-xs not-italic text-amber-700 dark:text-amber-400">unconfirmed</em>
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

      {message ? <p role="status" className="text-sm text-gray-500">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-full bg-accent px-5 py-2 font-medium text-sm text-on-accent">
          Save
        </button>
        <Link className="rounded-full border border-gray-300 bg-white hover:border-gray-500 px-4 py-2 text-sm" to={cancel}>
          Cancel
        </Link>
        {hasPages ? (
          <button type="submit" name="intent" value="read" className="py-2 text-sm text-gray-500 underline">
            Read it from the scan
          </button>
        ) : null}
      </div>
    </Form>
  );
}
