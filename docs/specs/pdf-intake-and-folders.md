# Spec: Every paper a PDF, to scale; and the vault as folders

Status: **approved** 2026-10-20; in progress.
Relates to: PRODUCT.md "Screens"; DECISIONS.md D1, D11, D12, D20, D22, D25,
D26, D27, D29, D39, D40, D41

## Objective

Two things the household asked for, built on what the vault already does.

1. **Every paper is kept as one PDF, the size of the real thing.** A photo of
   a passport taken at an angle on the kitchen table becomes a flat,
   straightened page exactly 125 × 88 mm. An emailed PDF keeps its own pages.
   A document gathered from several uploads becomes one PDF, pages in the
   order the household chose. No raster image is kept as a document file.
2. **The vault can be browsed as folders.** Person, then category, then the
   paper: the shape a filing cabinet has. Tick files or whole folders and
   download them as one ZIP, laid out the same way.

**Import is not finished until somebody says it is.** An upload becomes an
*intake*: a draft only its uploader and the admins can see, where pages are straightened,
sized, reordered and read, and the fields OCR proposed are corrected. Only
when it is submitted, built and checked does it become a document in the
vault. An unfinished intake waits for the next sign-in.

## Scope

In:

- Intakes: drafts of a document, private to the uploader and admins, holding pages
  from any number of uploads (PDFs and photos).
- Photo pages: corners found automatically (OpenCV), draggable when wrong;
  a size picked from the aspect ratio, overridable from a list; the page
  warped flat to that size at 300 dpi.
- One PDF per document, built at submit; the untouched original photo
  attached inside it.
- OCR read from the straightened pages, proposals editable at review.
- Existing image-only documents listed as unfinished, to be converted.
- A folders page with multi-select ZIP download.

Out, and why:

- **Deleting anything.** No DELETE grant exists on any vault table, and the
  self-checks in `0005`, `0007`, `0015` and `0016` refuse one. Converting an
  old image document files the PDF as a new version; the image version stays
  as superseded history (D20). Removing it is a separate decision (Open
  below).
- **Editing a filed PDF's pages.** Page work happens in the intake. A filed
  document is changed by filing a new version, as today.
- **Sending a page anywhere to be read.** Everything runs on this machine (D26).

## Design

### The intake (D40)

Three new tables, outside the vault's own (`drizzle/0017_intakes.sql`):

- `intakes`: `id`, `created_by` (users), `owner_id`, `category`, `title`,
  `record_id` (set when converting or renewing an existing record),
  `fields` jsonb (proposals and edits), `identifier_sealed` (D35),
  `created_at`, `updated_at`.
- `intake_sources`: each upload, sealed as a document file is (D12). A
  source PDF is stored once and referenced by each of its pages.
- `intake_pages`: `intake_id`, `source_id`, `source_page` (index within a
  source PDF, 0 for a photo), `position`, `corners` jsonb, `size` (preset
  key or `{w, h}` in mm), `rotation` (0/90/180/270).

**Who sees an intake: its uploader and the admins, and nobody else.** Not
another member, a third party or an emergency contact. An intake is a
half-sorted pile on somebody's desk, possibly a private paper (D17) not yet
marked so; the admin can reach it so an upload left half done is never stuck.
The policies need no new `perm` view: the uploader is
`public.current_app_user()` and the admin test is the existing
`perm.current_user_is_admin()`. Sources and pages are reached through a
subquery over `intakes`, so reach is decided in one place. A new intake must
be the caller's own, by someone who may file, for an owner and record already
in reach; `created_by` is outside the update grant. The app role gets SELECT,
INSERT, UPDATE (named columns) and DELETE on these three tables only; the
self-check restates the whole write surface and allows nothing new on vault
tables.

Because intakes are separate tables, no vault list, search, tree, count or
download can reach a draft by forgetting a status filter. That is the reason
for separate tables rather than a `status` column on `documents`.

Discarding an intake deletes its rows and blobs, after the transaction that
let go of them has committed.

**Seeing a draft's pages asks for the password,** as a download does (D4): the
review screen, the corner editor and every page image call `requireStepUp`.
A draft is the paper itself, and a draft can wait for days on a signed-in
browser.

### Photo to page

1. **Corners.** OpenCV (`@techstark/opencv-js`, WebAssembly, server only)
   finds the largest four-sided outline: greyscale, blur, Canny, contours,
   `approxPolyDP`. Run on a downscaled copy; corners scaled back. If nothing
   convincing is found, the corners are the photo's own edges and the review
   screen says so.
2. **Size.** The detected aspect ratio picks the nearest preset within 3%:
   ID-1 card 85.6 × 54 mm (licences, insurance and bank cards), ID-3
   passport page 125 × 88 mm, A4 210 × 297, Letter 215.9 × 279.4, A5
   148 × 210. Otherwise "Choose a size". The list also offers custom mm, and
   **As scanned**: a flatbed scan that records its DPI is used at that DPI,
   uncropped.
3. **Review.** The photo shown with four corner handles (pointer and
   keyboard: a handle takes arrow keys) and the size dropdown. A preview of
   the flattened page updates on release.
4. **Warp.** `getPerspectiveTransform` + `warpPerspective` to exactly the
   size at 300 dpi (an ID-1 card is 1011 × 638 px), then JPEG q92.
   WebP and TIFF are decoded by sharp first. HEIC is not accepted: the
   image library cannot decode HEVC, and leaving it out of the file input's
   types is what makes an iPhone send a JPEG.

Orientation: EXIF honoured before detection (the D29 fix); a page can be
turned a quarter at review.

### Building the PDF (D39)

`@cantoo/pdf-lib` (maintained MIT fork of pdf-lib) at submit:

- A photo page is a page of exactly its size in points (mm × 72 / 25.4),
  the warped JPEG drawn edge to edge.
- A PDF page is copied in as it is, its own size kept.
- Each photo's untouched original is attached inside the PDF
  (`attach()`, an embedded file), so a bad straighten can be redone from it.
- Metadata: title only. No author, no producer string naming the household.

**The check before it counts as filed.** The built bytes are parsed back:
page count and every page's size must match the intake to 0.5 pt, every
attachment present, and the sha256 recorded. Only then is it sealed and
filed through the existing write path: `records`, `documents`,
`document_files` (one file, `page_no` 1, `application/pdf`), the fields
saved through `saveFields` so they arrive confirmed, then the intake
deleted, all in one transaction. A failure leaves the intake as it was.

### OCR at review

Moves from filing to the intake. `readDocument` runs on each straightened
page, cached on the intake; a flat page reads better than the angled photo
did. Proposals fill the field form, each marked as read by machine until
edited or accepted. Submit confirms what the form holds, the way Save on a
record does today. The 25 MB limit stays per upload.

### Existing image documents

Every current document whose file is not `application/pdf` is listed under
**Unfinished** as "Convert to PDF", visible to whoever may file for its
record. Converting opens an intake with `record_id` set and its pages
loaded; submitting files the PDF as the next version (current flips, the
image version is superseded), fields carried over.

### The folders page (D41)

`/folders`. A tree drawn from `VAULT_LIST_SQL`, which already runs under the
read policies, so it adds no new way to see anything:

```
Priya Raman/
  Personal/
    Passport (2024).pdf
    Earlier versions/
      Passport (2014).pdf
  Medical/ …
The Hale household/ …
Shared with me/            ← documents reached by grant without their owner
```

Folders expand inline; each row has a checkbox, a folder's selects its
contents. **Download selected** posts the file ids to `/folders/download`.
The server asks for step-up (as `/file/:id` does), opens every id through
`findFile` under the viewer's own policies (an id the viewer cannot see
refuses the whole request, revealing nothing about which), writes one
`document.downloaded` activity row per file, and returns a ZIP (`fflate`,
stored, since PDFs are already compressed) with the paths above. Names are
built by `downloadName`, never logged.

ponytail: the ZIP is built in memory. Fine at household size (a few hundred
MB); stream it if a whole-vault download ever is not.

## Dependencies (to be added, with reasons)

| Package | Licence | Why |
|---|---|---|
| `@cantoo/pdf-lib` | MIT | Writing PDFs, copying pages, embedded attachments. Maintained fork of pdf-lib (last release 2021). |
| `@techstark/opencv-js` 4.12 | Apache-2.0 | Corner detection and perspective warp. WebAssembly; server only; ~14 MB on disk, nothing sent to the browser. |
| `fflate` | MIT | ZIP writing. Already arrives with the PDF library; declared directly because it is used directly. |

## Testing strategy

Tests first for every rule:

- Intake policies: the uploader and an admin see and edit an intake; another
  individual, a third party and an emergency contact see none; no intake appears
  in the vault list, search or counts.
- PDF builder: generated fictional pages (a ruled rectangle drawn by sharp,
  warped to an angle) come back flat to within 2 px, at exactly the preset
  size in points; a copied PDF page keeps its size; the attachment opens to
  the original bytes.
- Size guess: each preset's aspect ratio maps to it; an ambiguous one asks.
- Folders download: only visible ids; one invisible id refuses all; one
  activity row per file.
- `npm run backup:drill` after the schema change.

## Commits, in order

1. This spec, D39–D41 in DECISIONS.md, ROADMAP step 20.
2. Intake tables, policies, self-check amendments; tests first.
3. Page engine: corners, size guess, warp, PDF build, check; tests.
4. Upload and bulk make intakes; the review screen; submit.
5. Unfinished list (dashboard and sidebar count) and converting old images.
6. The folders page and ZIP download; tests.
7. DESIGN.md for the new screens, drill, browser pass at phone and desk widths.

## Settled when approved

1. **Old image versions after conversion** are kept as superseded history.
   Deleting them would be the vault's first DELETE grant and its own decision.
2. **Who sees a draft:** its uploader and the admins.
3. **An intake left for months** is kept until finished or discarded, and
   listed on the dashboard meanwhile.
