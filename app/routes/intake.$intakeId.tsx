import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/intake.$intakeId";
import { ACCEPTED_TYPES, CATEGORIES } from "../documents";
import {
  clearIdentifier,
  discardIntake,
  type FieldState,
  type IntakePage,
  loadIntake,
  movePage,
  parseSize,
  removePage,
  saveDetails,
  setPage,
  submitIntake,
  UploadRefused,
} from "../intake.server";
import { draftFromUploads, readInto, refusedByPolicy } from "../intake-request.server";
import { Masthead, Page } from "../masthead";
import { PAPER_SIZES, type PaperSize } from "../paper";
import type { EditableField } from "../record.server";
import { withVault } from "../session.server";
import { requireStepUp } from "../stepup.server";
import { deleteBlob } from "../storage.server";

export function meta() {
  return [{ title: "Finish filing — Safehouse" }];
}

/**
 * How this surface enforces access.
 *
 * A draft is read and changed through `withVault`, so `intakes_reach` and its
 * siblings decide whether this person reaches it at all (its uploader or an
 * admin, D40); somebody else gets no row, and a 404. Its pages are the papers
 * themselves, so looking at them asks for the password the way a download
 * does (`requireStepUp`, D4). Filing goes through `records_write` exactly as
 * an upload always has. The identifier is never sent to this page: it says
 * whether one is on file, and a new one can be typed over it.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    await requireStepUp(request, user);
    const intake = await loadIntake(db, params.intakeId);
    if (!intake) throw new Response("No such draft.", { status: 404 });

    const owners = await db.execute<{ id: string; displayName: string; kind: string }>(sql`
      select id, display_name as "displayName", kind from owners
      where archived_at is null order by kind, display_name
    `);
    return { intake, owners: [...owners], mine: intake.createdBy === user.id };
  });
}

const FIELD_LABELS: Record<EditableField, string> = {
  document_date: "Dated",
  issued_on: "Issued",
  expires_on: "Expires",
  issuer_country: "Issued by",
  place_of_issue: "Place of issue",
  original_location_note: "The original is kept",
  identifier: "Number",
};
const DATES = new Set<EditableField>(["document_date", "issued_on", "expires_on"]);
/** The form's fields, in order. Not `EDITABLE_FIELDS`: that lives in a server module the page cannot load. */
const FIELDS = Object.keys(FIELD_LABELS) as EditableField[];

export async function action({ request, params }: Route.ActionArgs) {
  const id = params.intakeId;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const pageId = String(form.get("pageId") ?? "");
  let released: string[] = [];

  try {
    switch (intent) {
      case "details":
        await saveDetailsFrom(request, id, form);
        return { saved: "Saved." };
      case "size":
        await withVault(request, (db) =>
          setPage(db, pageId, { size: parseSize(String(form.get("size")), String(form.get("w")), String(form.get("h"))) }),
        );
        break;
      case "turn-left":
      case "turn-right": {
        const rotation = (Number(form.get("rotation")) + (intent === "turn-left" ? 270 : 90)) % 360;
        await withVault(request, (db) => setPage(db, pageId, { rotation }));
        break;
      }
      case "up":
      case "down":
        await withVault(request, (db) => movePage(db, id, pageId, intent === "up" ? -1 : 1));
        break;
      case "remove":
        released = await withVault(request, (db) => removePage(db, id, pageId));
        break;
      case "add": {
        const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
        if (files.length === 0) return { error: "Choose a file to add." };
        const uploads = await Promise.all(files.map(async (f) => ({ mime: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
        await draftFromUploads(request, uploads, { intakeId: id });
        break;
      }
      case "read": {
        await saveDetailsFrom(request, id, form);
        const { proposed } = await readInto(request, id);
        return { saved: proposed ? `The reader proposed ${proposed} detail${proposed === 1 ? "" : "s"}.` : "The reader found nothing new." };
      }
      case "forget-number":
        await withVault(request, (db) => clearIdentifier(db, id));
        break;
      case "discard":
        released = await withVault(request, (db) => discardIntake(db, id));
        await Promise.all(released.map((key) => deleteBlob(key)));
        return redirect("/");
      case "file": {
        // What is in the form is what was checked: saved, then filed.
        await saveDetailsFrom(request, id, form);
        const filed = await withVault(request, (db) => submitIntake(db, id));
        await Promise.all(filed.released.map((key) => deleteBlob(key)));
        return redirect(`/record/${filed.documentId}`);
      }
      default:
        return { error: "Nothing to do." };
    }
    // Only now that the transaction that let go of them has committed.
    await Promise.all(released.map((key) => deleteBlob(key)));
    return null;
  } catch (error) {
    if (error instanceof UploadRefused) return { error: error.message };
    if (refusedByPolicy(error)) return { error: "You cannot file a document for that person." };
    throw error;
  }
}

/** The details form, saved; the same whether it was Save, Read again or File it that sent it. */
function saveDetailsFrom(request: Request, id: string, form: FormData) {
  return withVault(request, (db) =>
    saveDetails(db, id, {
      ownerId: String(form.get("ownerId") ?? ""),
      category: String(form.get("category") ?? ""),
      title: String(form.get("title") ?? ""),
      values: Object.fromEntries(FIELDS.filter((f) => form.has(f)).map((f) => [f, String(form.get(f))])),
    }),
  );
}

export default function Intake({ loaderData, actionData }: Route.ComponentProps) {
  const { intake, owners, mine } = loaderData;
  const busy = useNavigation().state !== "idle";
  const result = actionData as { error?: string; saved?: string } | null | undefined;
  const needsSize = intake.pages.filter((p) => p.kind === "photo" && !p.size).length;

  return (
    <>
      <Masthead
        title={intake.title || "Unfinished document"}
        seed="Unfinished"
        serial={`Unfinished · ${intake.pages.length} ${intake.pages.length === 1 ? "page" : "pages"}`}
      />
      <Page narrow>
        <p className="-mb-2 max-w-prose text-base text-gray-700">
          Check each page is straight and the right size, and that the details are right. Nothing is in the vault
          until you press File it.{mine ? "" : " An administrator can finish a draft somebody else started."}
        </p>

        {result?.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            {result.error}
          </p>
        ) : null}

        <section aria-labelledby="pages" className="sheet">
          <h2 id="pages" className="border-b border-gray-900 px-4 py-3 text-lg font-semibold md:px-5">Pages</h2>
          <ol className="divide-y divide-gray-200">
            {intake.pages.map((page, i) => (
              <PageRow key={page.id} intakeId={intake.id} page={page} n={i + 1} last={i === intake.pages.length - 1} />
            ))}
          </ol>
          <Form method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-3 border-t border-gray-200 px-4 py-4 md:px-5">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">
              Add pages
              <input type="file" name="file" multiple accept={ACCEPTED_TYPES.join(",")} className="font-normal" />
            </label>
            <button type="submit" name="intent" value="add" className="btn btn-secondary">Add</button>
          </Form>
        </section>

        <Form id="details" method="post" className="sheet flex flex-col gap-5 p-4 md:p-5" key={JSON.stringify([intake.values, intake.ownerId, intake.title, intake.category])}>
          <h2 className="-mx-4 -mt-4 border-b border-gray-900 px-4 py-3 text-lg font-semibold md:-mx-5 md:-mt-5 md:px-5">Details</h2>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Whose is it?
            <select name="ownerId" defaultValue={intake.ownerId ?? ""} className="field font-normal">
              <option value="">Choose a person, business or the household</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.displayName}{o.kind === "person" ? "" : ` (${o.kind})`}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            What is it?
            <input name="title" maxLength={200} defaultValue={intake.title ?? ""} placeholder="Passport, council tax bill" className="field font-normal" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Where does it belong?
            <select name="category" defaultValue={intake.category ?? ""} className="field font-normal">
              <option value="">Choose a kind</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </label>

          <p className="border-t border-gray-200 pt-4 text-sm text-gray-500">
            {intake.how ?? "Not read yet."} Whatever is here when you file it is recorded as checked, so clear anything that is wrong.
          </p>

          {FIELDS.map((field) => (
            <FieldInput key={field} field={field} state={intake.values[field]} hasIdentifier={intake.hasIdentifier} />
          ))}

          {result?.saved ? <p role="status" className="text-sm text-gray-500">{result.saved}</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" name="intent" value="details" className="btn btn-secondary">Save details</button>
            <button type="submit" name="intent" value="read" className="py-2 text-sm text-gray-500 underline hover:text-gray-900">
              Read the pages again
            </button>
          </div>
        </Form>

        <div className="flex flex-wrap items-center gap-4">
          {/* Part of the details form, so what is typed there is what is filed. */}
          <button type="submit" form="details" name="intent" value="file" disabled={busy || needsSize > 0} className="btn btn-primary">
            File it
          </button>
          <p className="text-sm text-gray-500">
            {needsSize > 0
              ? `${needsSize} ${needsSize === 1 ? "page needs" : "pages need"} a size first.`
              : "Saves the details, builds one PDF, checks every page is its size, then files it."}
          </p>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 underline">Discard this draft</summary>
          <Form method="post" className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-gray-700">Its pages are deleted. Nothing in the vault changes.</span>
            <button type="submit" name="intent" value="discard" className="btn btn-danger btn-sm">Discard</button>
          </Form>
        </details>
      </Page>
    </>
  );
}

function sizeLabel(size: PaperSize | null): string {
  if (!size) return "No size yet";
  if (size === "scanned") return "As scanned";
  if (typeof size === "string") return PAPER_SIZES[size].label;
  return `${size.w} × ${size.h} mm`;
}

function PageRow({ intakeId, page, n, last }: { intakeId: string; page: IntakePage; n: number; last: boolean }) {
  const src = `/intake/${intakeId}/page/${page.id}`;
  // A changed size or turn changes the picture; the query keeps the old one out of the cache.
  const version = encodeURIComponent(JSON.stringify([page.size, page.rotation, page.corners?.points]));
  const hidden = (
    <>
      <input type="hidden" name="pageId" value={page.id} />
      <input type="hidden" name="rotation" value={page.rotation} />
    </>
  );

  return (
    <li className="flex flex-col gap-4 px-4 py-4 sm:flex-row md:px-5">
      <div className="w-full shrink-0 sm:w-56">
        {page.kind === "photo" ? (
          <img
            src={`${src}?view=flat&max=600&v=${version}`}
            alt={`Page ${n} as it will be filed`}
            className="w-full rounded-sm border border-gray-300 bg-gray-100"
          />
        ) : (
          <object data={`${src}?v=${version}`} type="application/pdf" className="aspect-[3/4] w-full rounded-sm border border-gray-300 bg-gray-100">
            <a className="text-sm underline" href={src}>Open page {n}</a>
          </object>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Page <span className="font-mono">{n}</span></h3>
          {page.kind === "pdf-page" ? (
            <span className="text-sm text-gray-500">from a PDF, kept at its own size</span>
          ) : page.corners?.found ? (
            <span className="text-sm text-gray-500">a photo, its edges found</span>
          ) : (
            <span className="stamp stamp-soon">Edges not found</span>
          )}
        </div>

        {page.kind === "photo" ? (
          <>
            <SizeForm page={page}>{hidden}</SizeForm>
            <p className="text-sm text-gray-500">
              {sizeLabel(page.size)}.{" "}
              <Link className="underline hover:text-gray-900" to={`/intake/${intakeId}/corners/${page.id}`}>Adjust the corners</Link>
            </p>
          </>
        ) : null}

        <Form method="post" className="flex flex-wrap gap-2">
          {hidden}
          <button type="submit" name="intent" value="turn-left" className="btn btn-secondary btn-sm">Turn left</button>
          <button type="submit" name="intent" value="turn-right" className="btn btn-secondary btn-sm">Turn right</button>
          <button type="submit" name="intent" value="up" disabled={n === 1} className="btn btn-secondary btn-sm">Move up</button>
          <button type="submit" name="intent" value="down" disabled={last} className="btn btn-secondary btn-sm">Move down</button>
          <button type="submit" name="intent" value="remove" className="btn btn-secondary btn-sm">Remove</button>
        </Form>
      </div>
    </li>
  );
}

/** The size picker. Millimetres are asked for only when "another size" is the choice. */
function SizeForm({ page, children }: { page: IntakePage; children: React.ReactNode }) {
  const custom = page.size && typeof page.size === "object" ? page.size : null;
  const [choice, setChoice] = useState(custom ? "custom" : typeof page.size === "string" ? page.size : "");

  return (
    <Form method="post" className="flex flex-wrap items-end gap-2">
      {children}
      <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
        Real size
        <select name="size" value={choice} onChange={(e) => setChoice(e.target.value)} className="field font-normal">
          <option value="" disabled>Choose a size</option>
          {Object.entries(PAPER_SIZES).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
          <option value="scanned">As scanned, at its own resolution</option>
          <option value="custom">Another size, in mm</option>
        </select>
      </label>
      {choice === "custom" ? (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Width, mm
            <input name="w" inputMode="decimal" required defaultValue={custom?.w ?? ""} className="field w-24 font-mono font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Height, mm
            <input name="h" inputMode="decimal" required defaultValue={custom?.h ?? ""} className="field w-24 font-mono font-normal" />
          </label>
        </>
      ) : null}
      <button type="submit" name="intent" value="size" className="btn btn-secondary">Set size</button>
    </Form>
  );
}

function FieldInput({ field, state, hasIdentifier }: { field: EditableField; state?: FieldState; hasIdentifier: boolean }) {
  const read = state && state.source !== "person";
  const label = (
    <span className="flex items-center gap-2">
      {FIELD_LABELS[field]}
      {read ? <em className="stamp stamp-soon not-italic">read by machine</em> : null}
    </span>
  );

  if (field === "identifier") {
    return (
      <div className="flex flex-col gap-1.5 text-sm font-medium">
        <label className="flex flex-col gap-1.5">
          {label}
          <input
            name="identifier"
            autoComplete="off"
            placeholder={hasIdentifier ? "A number is on file. Type to replace it." : ""}
            className="field font-mono font-normal"
          />
        </label>
        {hasIdentifier ? (
          <button type="submit" name="intent" value="forget-number" className="self-start text-sm font-normal text-gray-500 underline hover:text-gray-900">
            Clear the number on file
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input
        name={field}
        type={DATES.has(field) ? "date" : "text"}
        defaultValue={state?.value ?? ""}
        className={"field font-normal" + (DATES.has(field) ? " font-mono" : "")}
      />
    </label>
  );
}
