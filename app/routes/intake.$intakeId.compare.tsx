import { Form, Link, redirect } from "react-router";
import { sql } from "drizzle-orm";

import type { Route } from "./+types/intake.$intakeId.compare";
import { discardIntake, loadIntake, NewerVersion, submitIntake, UploadRefused } from "../intake.server";
import { refusedByPolicy } from "../intake-request.server";
import { Masthead, Page } from "../masthead";
import { findRecordView } from "../record.server";
import { withVault } from "../session.server";
import { requireStepUp } from "../stepup.server";
import { deleteBlob } from "../storage.server";
import { longDate, When } from "../when";

export function meta() {
  return [{ title: "A newer version was filed — SafeHouse" }];
}

/**
 * Somebody filed a version of this paper while the draft was open (D42). Both
 * are shown, and the person decides: file theirs as the newest, discard it, or
 * go back to it. Nothing is deleted either way; a superseded version stays in
 * the record's history (D20).
 *
 * How this surface enforces access: the draft through the intake policies,
 * the newer version through `documents_read` (findRecordView), and a recent
 * password before either is shown (D4). Filing over it passes the id of the
 * version shown, so a third version filed in the meantime asks again.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  return withVault(request, async (db, user) => {
    await requireStepUp(request, user);
    const draft = await loadIntake(db, params.intakeId);
    if (!draft?.recordId) throw new Response("No such draft.", { status: 404 });

    const [current] = [
      ...(await db.execute<{ id: string; filedAt: Date }>(sql`
        select d.id, d.created_at as "filedAt" from documents d where d.record_id = ${draft.recordId} and d.is_current
      `)),
    ];
    // Nothing newer after all (or nothing this person can see): back to the draft.
    if (!current || current.id === draft.baseDocumentId) throw redirect(`/intake/${draft.id}`);

    const newer = await findRecordView(db, current.id);
    if (!newer) throw redirect(`/intake/${draft.id}`);
    return { draft, newer, filedAt: current.filedAt };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const id = params.intakeId;

  try {
    if (form.get("intent") === "discard") {
      const released = await withVault(request, (db) => discardIntake(db, id));
      await Promise.all(released.map((key) => deleteBlob(key)));
      return redirect(`/record/${String(form.get("over"))}`);
    }
    const filed = await withVault(request, (db) => submitIntake(db, id, { over: String(form.get("over") ?? "") }));
    await Promise.all(filed.released.map((key) => deleteBlob(key)));
    return redirect(`/record/${filed.documentId}`);
  } catch (error) {
    // Yet another version since this page was drawn: draw it again.
    if (error instanceof NewerVersion) return redirect(`/intake/${id}/compare`);
    if (error instanceof UploadRefused) return redirect(`/intake/${id}`);
    if (refusedByPolicy(error)) return { error: "You cannot file a new version of that one." };
    throw error;
  }
}

const LABELS: [string, string][] = [
  ["documentDate", "Dated"],
  ["issuedOn", "Issued"],
  ["expiresOn", "Expires"],
  ["issuerCountry", "Issued by"],
  ["placeOfIssue", "Place of issue"],
  ["originalLocationNote", "The original is kept"],
];
const DRAFT_FIELD: Record<string, string> = {
  documentDate: "document_date",
  issuedOn: "issued_on",
  expiresOn: "expires_on",
  issuerCountry: "issuer_country",
  placeOfIssue: "place_of_issue",
  originalLocationNote: "original_location_note",
};
const DATES = new Set(["documentDate", "issuedOn", "expiresOn"]);

export default function Compare({ loaderData, actionData }: Route.ComponentProps) {
  const { draft, newer, filedAt } = loaderData;
  const shown = (key: string, value: string | null | undefined) =>
    value ? (DATES.has(key) ? <span className="font-mono">{longDate(value)}</span> : value) : <span className="text-gray-500">Not recorded</span>;

  return (
    <>
      <Masthead title="A newer version was filed" serial={draft.title ?? undefined} />
      <Page>
        <p className="-mb-2 max-w-prose text-base text-gray-700">
          While your draft was open, somebody filed a version of this paper. Filing yours now makes it the newest and puts
          theirs in the history. Nothing is deleted either way. Look at both, then choose.
        </p>

        {actionData?.error ? <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100">{actionData.error}</p> : null}

        <div className="sheet overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th scope="col" className="index w-40 px-4 py-3 font-semibold text-gray-500 md:px-5"><span className="sr-only">Detail</span></th>
                <th scope="col" className="px-4 py-3 md:px-5">
                  <span className="block font-semibold">Filed, version <span className="font-mono">{newer.document.versionNo}</span></span>
                  <span className="text-xs font-normal text-gray-500"><When at={filedAt} /></span>
                </th>
                <th scope="col" className="px-4 py-3 md:px-5">
                  <span className="block font-semibold">Your draft</span>
                  <span className="text-xs font-normal text-gray-500">not filed</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr>
                <th scope="row" className="index px-4 py-3 text-left align-top font-semibold text-gray-500 md:px-5">Pages</th>
                <td className="px-4 py-3 align-top md:px-5">
                  <ul className="flex flex-col gap-1">
                    {newer.pages.map((p) => (
                      <li key={p.id}>
                        <a className="underline" href={`/file/${p.id}`}>Page <span className="font-mono">{p.pageNo}</span></a>{" "}
                        <span className="text-gray-500">{p.mime === "application/pdf" ? "PDF" : "image"}</span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3 align-top md:px-5">
                  <ul className="flex flex-wrap gap-2">
                    {draft.pages.map((p, i) =>
                      p.kind === "photo" ? (
                        <li key={p.id}>
                          <img src={`/intake/${draft.id}/page/${p.id}?view=flat&max=300`} alt={`Your page ${i + 1}`} className="h-24 rounded-sm border border-gray-300" />
                        </li>
                      ) : (
                        <li key={p.id}>
                          <a className="underline" href={`/intake/${draft.id}/page/${p.id}`}>Page <span className="font-mono">{i + 1}</span></a>
                        </li>
                      ),
                    )}
                  </ul>
                </td>
              </tr>
              {LABELS.map(([key, label]) => {
                const theirs = newer.document[key as keyof typeof newer.document] as string | null;
                const yours = draft.values[DRAFT_FIELD[key] as keyof typeof draft.values]?.value;
                const differs = (theirs ?? "") !== (yours ?? "");
                return (
                  <tr key={key}>
                    <th scope="row" className="index px-4 py-3 text-left font-semibold text-gray-500 md:px-5">{label}</th>
                    <td className="px-4 py-3 md:px-5">{shown(key, theirs)}</td>
                    <td className="px-4 py-3 md:px-5">
                      {shown(key, yours)}
                      {differs ? <span className="stamp stamp-soon ml-2">Differs</span> : null}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <th scope="row" className="index px-4 py-3 text-left font-semibold text-gray-500 md:px-5">Number</th>
                <td className="px-4 py-3 md:px-5">{newer.document.hasIdentifier ? "On file, masked" : <span className="text-gray-500">Not recorded</span>}</td>
                <td className="px-4 py-3 md:px-5">{draft.hasIdentifier ? "On file, masked" : <span className="text-gray-500">Not recorded</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="over" value={newer.document.id} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" name="intent" value="file" className="btn btn-primary">File mine as the newest</button>
            <button type="submit" name="intent" value="discard" className="btn btn-secondary">Keep theirs, discard mine</button>
            <Link className="py-2 text-sm text-gray-500 underline hover:text-gray-900" to={`/intake/${draft.id}`}>Back to my draft</Link>
          </div>
          <p className="text-sm text-gray-500">
            Filing yours keeps theirs as version <span className="font-mono">{newer.document.versionNo}</span> in the history.
          </p>
        </Form>
      </Page>
    </>
  );
}
