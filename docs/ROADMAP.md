# Safehouse — Roadmap

The order of the remaining work, and why it is that order.

Product intent is `PRODUCT.md`. The reasoning behind the architecture is
`DECISIONS.md`. This file is neither: it is the sequence, with the dependency
that forces each position written next to it.

---

## What "done" means

- The six screens in `PRODUCT.md` §Screens: Dashboard, Vault, Record, Search,
  Bulk, Settings.
- The three modal flows: Upload, Add member, Add business.
- The access console in both its views (D21).
- D1–D25 honoured in code, not only in prose. Several are currently promises
  with no implementation behind them — D6, D12, D13, D14's obligations, D19's
  alerting, D20's page model.
- A household that is not this one can install it, seed itself, and run it
  without reading the source.

## Where things stand

Built: the schema; the permission layer (row-level security, the `perm` schema,
five `security definer` functions); sign-in, sign-out and first-run admin; the
vault list; view-as; a dev seed; the committed permission matrix. Then Act I —
envelope encryption, the write policies, filing a document, downloading one
behind a step-up check, the append-only activity log, and backups with a drill
that restores one. Then the Record screen, the local reader (MRZ, PDF text
layer, Tesseract), insurance classification and quoting, page straightening,
and the expiry list. Then the people roster with invites and resets, a boot
check that refuses the wrong key, the family tree, the access console, and
search over sealed identifiers, the dashboard, bulk intake, settings and
two-factor, break-glass with alerts delivered by webhook, and operations: an
upgrade command, drills the dashboard watches, and the runbook.

Not built: first run for an empty household (Step 18, deferred).

In one line: **a document goes in encrypted, comes out to exactly whoever may
see it, gets read for what it says, and the vault volunteers what is running
out.**

## How to work through it

Carried forward from the view-as work, because it held up:

- A step that opens a new security surface gets a spec in `docs/specs/` first.
- The test for a permission rule is written before the rule (CLAUDE.md).
- Every surface that lists documents states how it enforces access, in the
  loader, next to the query. `app/routes/vault.tsx` is the model.
- `app/db/matrix.txt` is part of review. Any permission change should be read as
  a diff of that file before it is read as a diff of SQL.
- Each step ends with the suite green and something a person can look at.
  No step parks a half-written policy over a weekend.

---

# Act I — The vault becomes real — **done**

A household can put documents in, read them back, and not lose them. Nothing in
Act II is worth building until this is true, and D6 says in as many words that
backups block putting real documents in.

### Step 1 — Grow the fixture to the shape PRODUCT.md describes

**Why first.** It is the cheapest step on the list and everything visual is
unbuildable without it. Twelve documents cannot show grouping pressure, a
picker of eleven names cannot show what fifty looks like, and "3 of 12" does not
exercise the sentence the product specified as "14 of 36".

**Work.** Eleven people is already right. Take documents to roughly 36 across
all six categories; add the second third-party (the estate attorney, who today
has no fixture presence although `PRODUCT.md` §Access control names them);
several expiries inside 90 days for the expiring-soon surfaces; at least one
more superseded version. Fictional, always (D7).

**Acceptance.** `app/db/matrix.txt` churns once, reviewed as a diff, and the
new rows are explicable. Every existing permission test still passes or is
updated with a reason in the commit message.

**Size.** S. **Depends on.** Nothing. **Closes.** Spec open question 6.

### Step 2 — Storage and the key, with no route attached

**Why here.** D12 is the one piece of this product where a mistake is silent and
permanent. Build it alone, provable in tests, before any HTTP surface can reach
it.

**Work.** A key provider with one implementation — the mounted key file read at
boot — behind an interface, because D12 says adding passphrase unlock later must
not touch the schema. Envelope encryption per file: a fresh data key per file,
wrapped by the master key, stored in `wrapped_dek` with its `nonce`. A storage
module that writes and reads a blob by `storage_key` on local disk.

**New security surface.** The key. It is excluded from every backup path (D12),
and its own custody — printed, offline, elsewhere — is part of Step 6, not an
afterthought.

**Acceptance.** Round-trip test: encrypt, write, read, decrypt, byte-identical.
A file on disk is unreadable without the key. Key rotation re-wraps data keys
and never rewrites a document file. Nothing in the repo or in any log holds key
material.

**Size.** M. **Depends on.** Nothing.

### Step 3 — The first write policy: upload

**Why here.** Every policy in the database today is a `using` clause over reads.
A `with check` is a different question — "may see this record" is not "may add a
document to it" — and getting it wrong files somebody's passport into the wrong
person's vault. It is the single highest-risk step in this roadmap.

**Work.** Write policies for `records`, `documents` and `document_files`, each
with its test written first. The upload flow: a file arrives, is encrypted by
Step 2, and lands as a document under a record — per D20, a bare General record
is created automatically when the upload does not name one, so the vault stays
one query rather than a union. Start with one file, one owner, no bulk.

**The guard this step owes.** The moment a write policy exists, "never write
while viewing as" stops being structurally true and becomes a thing code must
enforce. `withViewedVault` gets a guard on `isViewingAs` in this step's commit —
`docs/specs/view-as.md` §What comes after this names this debt and this is where
it is paid.

**Acceptance.** A non-admin cannot write a document to an owner they may only
read. An admin viewing as somebody else cannot write at all. The matrix diff
after an upload names exactly the people who gained the new document.

**Size.** L. **Depends on.** Steps 1, 2. **Spec first.**

### Step 4 — Download, with step-up re-authentication

**Why here.** This is where "the server never sends a document the requester
isn't entitled to see" stops being about lists and starts being about bytes.

**Work.** A file route that resolves permission server-side, reads the blob,
unwraps the data key, decrypts and streams. Step-up re-authentication before the
bytes, per D4's consequences — a valid session is not sufficient for a download.

**Acceptance.** Every fixture account against every file, as a committed table
the way `matrix.txt` works for documents. A direct request for a `storage_key`
belonging to somebody else is refused, not merely unlinked in the UI. No
document content, file name or field value in any log line (CLAUDE.md).

**Size.** M. **Depends on.** Steps 2, 3. **Spec first.**

### Step 5 — The activity log

**Why here, and not later.** It looks like a feature and is actually a
dependency. D14 accepts that record field values sit readable in the database,
and the obligations it takes on in exchange include *every reveal of a masked
field written to the activity log* — so masking in Step 7 cannot ship before
this exists. D19 requires the same for every emergency-window access.

**Work.** An append-only log of views, downloads, uploads, grants and role
changes. Writable by the app role, never updatable or deletable by it — that is
a policy, not a convention. Readable by the admin.

**Acceptance.** A row per download from Step 4. No document content or field
value in any row, only identifiers (CLAUDE.md). An attempt to update or delete a
log row as the app role is refused by Postgres.

**Size.** M. **Depends on.** Step 3. **Spec first.**

### Step 6 — Backup, restore, and a restore drill

**Why this ends Act I.** D6 says it plainly: *this blocks putting real family
documents in; do not skip and plan to circle back.* Until a restore has been
performed, this is a vault that eats documents.

**Work.** An encrypted backup of the database and the file store — a plaintext
backup defeats D5. The key file is excluded from every backup path (D12) and its
custody is documented here: printed, offline, somewhere else, because losing it
loses every document. A restore procedure, and a drill that runs it into a
scratch database and verifies a decrypted file matches its `sha256`.

**Acceptance.** A restore from a backup made on a different day yields a working
vault and a readable document. The drill is a command, not a wiki page. The
backup contains no key material.

**Size.** M. **Depends on.** Steps 2, 3.

**Act I is done.** Proved end to end over HTTP on 2026-10-06: sign in, file a
604-byte document, ask for it back and be sent to the password form, confirm,
and receive bytes identical to the ones uploaded. The copy on disk is 620
bytes, shares nothing with the plaintext, and does not contain its header. The
download is in the log. A backup taken afterwards drilled clean: 37 documents
restored into a throwaway database and the file opened and verified against the
digest recorded when it was filed.

Real documents can responsibly go in — after the key is regenerated, because
the development one was printed into a conversation.

---

# Act II — It becomes usable

### Step 7 — The Record screen

Pages, version stack, and the structured field panel (D20). Masking per
`PRODUCT.md` §Documents vs records: a masked value is absent from the payload,
not hidden in CSS (CLAUDE.md). Revealing one is a privileged action that writes
to the Step 5 log before it answers.

The fields themselves already exist — `issued_on`, `expires_on`,
`issuer_country`, `identifier`, `place_of_issue`, and `details` for whatever a
document type needs. Nothing has ever displayed or written them. This screen is
where a person enters them by hand, and it has to work by hand before anything
tries to fill them automatically.

It also brings the confirmation state D26 requires: every field needs to carry
whether a person has agreed with its value, so that "nobody has checked this"
is representable before Step 8 starts proposing values.

Gated by spec open question 4 — whether a per-record grant carries its owner's
name — because this screen is where that reads as a blank or a sentence.

**Size.** L. **Depends on.** Steps 4, 5.

### Step 8 — Reading what the scan says

The point of the whole thing: a document that is more than a picture. Fill the
fields from Step 7 out of the scan itself, on this machine (D26).

Two readers, because the documents divide cleanly. Passports, ID cards and
visas carry a machine-readable zone — the two lines of chevrons at the foot —
which yields surname, given names, date of birth, nationality, document number
and expiry, with check digits that say whether the read was clean. That is the
household's highest-value case and it is close to perfect. Everything else gets
a general local text read, which is adequate on a flat scan and poor on a
crumpled bill, and the interface says so rather than pretending otherwise.

**Nothing extracted is trusted.** Every value arrives as a proposal against the
field it belongs to, and a person confirms or corrects it. An unconfirmed value
is never used to decide anything — in particular it does not drive Step 9. A
failed check digit produces "could not read this cleanly", not a number. An
optical misread that silently becomes a renewal date is worse than no
extraction at all.

**The engine is settled (D27):** Tesseract 5 as a system package, with the PDF
text layer read before it ever runs — most of what a household files is
generated digitally and already carries its text, exactly.

**Acceptance.** A passport scan fills six fields with check digits verified; a
deliberately corrupted strip fills none and says why; no code path in the
extraction reaches the network, asserted rather than assumed; an unconfirmed
value cannot reach a reminder.

### Step 8b — Reading terms-bearing documents

Landed with step 8. Insurance paperwork is standardised by law, so the vault
classifies it, quotes the figures off the schedule with the insurer's own label
and the page, and indexes the conditions by heading so a household turns to the
right page instead of reading the booklet.

It does not say what a policy means, and D28 records why that is a structural
refusal rather than a missing feature.

**Size.** M. **Depends on.** Step 8.

**Size.** L. **Depends on.** Steps 6, 7. Backups first, because extraction puts
far more of a household's identifiers into the database and D14's obligations
get heavier, not lighter (D26).

### Step 9 — What expires, and saying so — **done**

The first thing the extracted data pays for. A vault that knows a passport
expires in March and says nothing in January is a worse filing cabinet than a
drawer.

Landed as `app/expiry.server.ts` and a section on the home page. The list is
recomputed against the database's own clock on every view — no job, no queue, no
stored reminder. **The write policy for `notifications` was deliberately not
built**, which is the one place this departed from the plan written here: there
is nothing to store that is not already in the vault, and a copy of a derivable
fact is a copy that can disagree. Rows arrive with Step 17, which needs
something to mark as delivered. D30 records the reasoning and what it narrows in
D13.

Only confirmed dates count (D26), and only current versions (D20). Already
expired documents are in the list, first.

**Acceptance, as met.** Nine tests in `app/db/expiry.test.ts`. 58 days in and 67
days out at the default window; 89 in and 103 out once the household's setting
says ninety-five, which is what proves the setting is read rather than a
constant. The office lease at 45 days is inside the window and unconfirmed, and
does not appear. A superseded permit is confirmed and long expired, and does not
appear. The accountant is not told about the family's passports, and every id in
anybody's list is a document that viewer can read. Both guards were verified by
removing them and watching the tests fail.

The in-app list names record titles, because it is the vault behind the same
policies as every other list. D13's rule governs what leaves the app, which is
Step 17's problem.

**Size.** M. **Depends on.** Step 8.

### Step 10 — People: roster, invites, add-member wizard

Today the only account that can exist is the first admin through `/setup`. The
sign-up endpoint is admin-gated but has no interface, so every deployment is a
household of one. D13 says invites and password resets work without email: the
admin generates a single-use link and delivers it by hand.

The wizard is built around one sentence — *"___ is the ___ of ___."* — with the
root case as its own card (`PRODUCT.md` §Screens).

**Landed.** The roster
and the add-member form are `/people`, over `app/people.server.ts`. Migration
0009 gives the app role INSERT on `owners`, `people` and `relationships`, admin
only: a tree edge is read by `family_circle`, so adding one is an access-control
change rather than data entry. The migration asserts the admin predicate in each
policy's text, because widening it to `current_user_may_file()` would leave every
test green. A partial unique index keeps one login per person. Siblings get
the anchor's parents rather than a sibling edge, and a sibling of somebody with
no recorded parent is refused. Each addition is logged as `person.added`.

Invites and password resets are the same link (D32). On a person's roster row
the admin either invites them by email or makes a new sign-in link, then
delivers it by hand. `/set-password` spends it. The library's public reset
endpoint answers only to an active admin.

**Acceptance, as met.** Fourteen tests in `app/db/people.test.ts`: who may add (an
admin may; a member, a third party and an anonymous request may not, with SQLSTATE
42501), the direction of each edge the sentence produces, and what the roster
shows each kind of viewer. Fourteen more in `app/invites.test.ts`:
- Who may make a link: not a stranger, a member, or a disabled admin, through
  any route.
- An invite makes an `individual` with no password, and cannot take an address
  or a person that is already taken.
- A link works once, a short password does not spend it, and a reset ends the
  account's other sessions.

The reset gate, the session revocation, the admin check that comes before any
lookup, and the disabled check were each removed and a test went red.

**Size.** L. **Depends on.** Step 3 (it writes people and relationships).

### Step 11 — The family tree

The app's primary navigation device, and real data rather than decoration: the
circle the access model derives comes from these rows (D16). Pan, zoom, click a
person, the vault below filters to them.

**Landed.** `/tree` draws the household as an SVG laid out by generation
(`app/tree-layout.ts`, no new dependency). You can drag to pan and use the
wheel or buttons to zoom. Every person is a link that keyboard users can
reach. A click goes to `/vault?owner=`, which narrows rows the vault's
policies already returned and keeps view-as. Names, a deceased mark and
female/male marks are shown; ended relationships are dashed and labelled
(D33). Businesses and the household are tabs beside the family. Recording sex
added migration 0011 and a field on the add-member form.

**Acceptance, as met.**
- `app/db/tree.test.ts`: the admin gets everyone and every edge including ended
  ones; Maya gets her five people and no edge leaving her circle; a third party
  and an unattached account get nothing; the payload has no names beyond the
  display name and no dates.
- `app/tree-layout.test.ts`: parents above children, spouses side by side,
  deterministic, a cycle still terminates. Two rules were removed and a test
  went red each time.
- `app/db/view-as.test.ts`: `?owner=` gives the same empty answer for a
  hidden, nonexistent or malformed owner.
- In a browser: Priya, and Priya viewing as Maya, with click-through, tabs,
  Tab and Enter, and a drag that pans rather than navigating.

**Not done.** The Individuals/Businesses switch landed with Step 14, and
editing or ending a relationship from the tree has no surface yet.

**Size.** L. **Depends on.** Step 10.

### Step 12 — The access console

Per-user panel as the only place grants are edited; the matrix as a read-only
audit view that opens a panel when a cell is clicked (D21). Both views read the
same permission view the vault reads, so they cannot disagree with what a user
actually sees.

Most of the data layer already exists: view-as computes reach per user, and
`app/db/matrix.test.ts` already renders the grid. What is new is grant editing,
which is a write policy, and which the Step 5 log records.

Gated by spec open question 5 — whether the admin's reach stays the denominator
in "N of M" — because the reach bar is that number drawn.

**Landed.** Open question 5 is closed by D34: the denominator stays the admin's
own reach, worded "of the 36 you can see", and shown to admins only.
`/access?as=` is one account's panel. It shows their reach as a bar, the owners
they can see (granted ones marked), and a form per grant list.
`/access?view=matrix` is the read-only grid, and every cell opens that row's
panel. `0012_grant_writes.sql` makes the three grant tables insert-and-delete
for the admin only. Each change is logged with what it changed, in typed
columns.

**Acceptance, as met.**
- `app/db/grants.test.ts`: the admin adds and removes each kind. A member, a
  third party, an emergency contact, an unattached account, a nameless
  transaction and a disabled admin are all refused. A refused delete leaves
  the row in place. A per-record grant opens a private record, and removing it
  closes it. Four policy mutations each turned a test red.
- `app/db/access.test.ts`: the console's matrix equals `matrix.txt` for every
  account. Each change is logged, and saving an unchanged list logs nothing. A
  non-admin gets 403 from the panel and the matrix.
- In a browser: Priya widened Sam's access (Rose: 9, unchanged; plus Legal: 10),
  the matrix agreed, and she put it back. The four log lines are in the dev
  database. Maya signed in herself: no link, 403 on every console URL, and a
  hand-posted grant was refused.

**Not done.** Roles, disabling, and emergency windows (D34).

**Size.** M. **Depends on.** Steps 3, 5.

### Step 13 — Search

Across titles, categories, tags and record field values: finding a passport by
its number is the stated bar (`PRODUCT.md` §Screens). Step 8 is what makes this
worth building — searching fields nobody ever filled in finds nothing.

**Decide before building.** D14 records a considered alternative — store the
value encrypted alongside keyed fingerprints of the whole number and the last
four digits, which survives a stolen database but cannot do arbitrary substring
search. Choosing it after search ships is a migration; choosing it before is a
design.

**Landed.** The household chose the alternative (D35, replacing D14).
`documents.identifier` is now three columns: the number sealed with
AES-256-GCM, plus keyed fingerprints of the whole number and its last four
characters. Both keys are derived from the KEK. A dump of the dev database
holds no readable number. `npm run db:migrate` runs `identifiers:seal`, which
sealed the 22 dev numbers and validated a constraint that keeps the old column
empty. `/search?q=` matches words against titles, kinds, subcategories and
owner names, and a number by its fingerprint. It reads through the policies,
supports view-as, and logs every match on a number. The backup drill now opens
every sealed number too.

**Acceptance, as met.**
- `app/field-crypto.server.test.ts`: a value opens only in its own row and
  only under its own key; tampering is refused; the fingerprint ignores
  spacing and case; the last-four fingerprint is not the whole-number one.
- `app/db/record.test.ts`: no readable number anywhere in the documents table.
  A typed, proposed or cleared number keeps all three columns together, and
  the old column refuses a write.
- `app/db/search.test.ts`: results stay within reach, for both words and
  numbers. An exact number for a document out of reach answers nothing. A
  middle fragment finds nothing. No hit carries the number. Matches are logged
  as the actor, with the viewed user under view-as. Four mutations each turned
  a test red.
- In a browser: Priya found Maya's passport by its number typed loosely, and
  by its last four. Reveal opened it under the dev key. Maya got nothing for
  Nadia's number.

**Also fixed.** The reveal button on the Record screen was a form nested
inside the fields' form. That is invalid HTML, and it broke hydration and
swallowed the click. It is now a button.

**Not done.** Substring search inside a number (the trade). Dropping the empty
`identifier` column (a later migration). Tags, which do not exist yet.

**Size.** M. **Depends on.** Step 8.

### Step 14 — Dashboard

The tree, expiring-soon, category overview, quick-search chips. The
expiring-soon list is Step 9's query, given a home.

**Landed.** `/` is the dashboard. An Individuals / Businesses switch
(`/?mode=businesses`) splits it by owner kind; a record whose owner the viewer
cannot see counts under Individuals. Individuals draws the tree (the `/tree`
drawing, now `app/tree-picture.tsx`) and links the household's papers;
Businesses lists the businesses. Both show expiring-soon for that mode, a
six-category overview whose tiles land on that section of the vault, a search
box, and up to eight chips built from the subcategories the viewer has
documents in. All of it comes from `getDashboard` in one `withVault`
transaction, with no permission logic and no identifier.

**Acceptance, as met.**
- `app/db/dashboard.test.ts`: the admin's counts in each mode equal the owner
  connection's count of current documents by owner kind. The expiring list
  splits by mode, and its two halves are the whole list. Maya has no
  businesses. Daniel sees the one he was granted. Sam's hidden-owner will
  counts under Individuals. An unattached account gets an empty dashboard. No
  number is in the payload. Three mutations each turned a test red.
- In a browser: Priya in both modes. The switch, a chip (Permits found the
  trading permit) and a category tile (landed on `#financial`) all work.
  Maya sees her five people, no Access link, and no businesses.

**Not done.** The switch governs the dashboard only; the vault and search keep
their own filters. View-as is on the vault, tree and search, not here.

**Size.** M. **Depends on.** Steps 9, 11, 13.

### Step 15 — Bulk intake

The triage surface for a large intake across people and categories at once. D20
is explicit that a 200-file intake creates 200 records, and that this is the
intended card model rather than an accident. Step 8 runs over each of them,
which is what makes a 200-file intake survivable.

**Landed.** `/bulk` (linked from the dashboard as "File many"). You pick many
files and sort them in one table in the browser: owner, kind and title per
row, plus "apply to all". Nothing is sent until every row has an owner. Files
then go one per request to `/bulk/file`, which answers in JSON, so every row
shows its own outcome and one refusal does not stop the batch. Each file is
read by the Step 8 reader on the uploaded bytes, outside any transaction. It
is then filed together with what the reader proposed, in one transaction
(`app/bulk.server.ts`). Proposals stay unconfirmed and numbers are sealed. A
blank title becomes "<Kind> document", and the file's name is never stored.

**Acceptance, as met.**
- `app/db/bulk.test.ts`: a filed document arrives with its proposals, none
  confirmed, and the number is sealed. A reader that throws still files the
  document. A third party, or a member filing outside their circle, is refused
  by the database and leaves no row and no blob. A proposal that cannot be
  saved takes the filing back and deletes its blob. One log line per
  document. Three mutations each turned a test red.
- In a browser, as Maya, with four fictional files: two PDFs and a PNG filed,
  and a .txt refused by type. The gym card's "Valid until 31/12/2027" was
  proposed as an unconfirmed expiry date. A hand-posted filing for Nadia got
  a 403 and wrote nothing.

**Not done.** Re-sorting after filing: moving a record to another owner
changes who can see it, and needs its own write policy. Pictures inside PDFs
are still not read (Step 8). Files go in one at a time; that is deliberate, so
a home server is not running several Tesseract reads at once.

**Size.** L. **Depends on.** Steps 3, 8.

---

# Act III — The parts that are not about documents

### Step 16 — Settings and security

Account, Security, Notifications panels. Two-factor, auto-lock interval, active
devices, and the emergency ceiling — which stays a constant in code, with the
setting able to be raised only up to it (D19).

**Landed** (D36). `/settings` has Account (change password), Security
(two-factor from better-auth's own plugin, signed-in devices, auto-lock), a
Notifications list, and Household: lead days, emergency hours and auto-lock
minutes. Only an admin can change the household numbers. The emergency ceiling
is 72 hours, held in `app/settings.ts` and in a check constraint, and a test
keeps the two equal. Sign-in gains `/sign-in/code` when two-factor is on.

**Acceptance, as met.**
- `app/db/settings.test.ts`: the admin changes each number within range. Out
  of range, past the ceiling, the row id and a second row are all refused.
  Members, third parties, emergency contacts, a nameless transaction and a
  disabled admin change nothing. A loosened policy turned four tests red.
- `app/two-factor.test.ts`: enabling needs the password and a working code. A
  password alone then gets no session, and a wrong code gets nothing. A backup
  code works once. Turning it off needs the password. The secret is stored
  encrypted, and the vault role cannot read it. The device list holds only the
  caller's own sessions and no token, and someone else's session cannot be
  signed out.
- In a browser: the settings page as Priya. 73 hours was refused with the
  ceiling named, and 48 saved and was put back.

**Not done.** A QR code for the authenticator (a dependency). An admin
rescue for a member who has lost their phone and backup codes. Auto-lock
enforced on the server.

**Size.** M. **Depends on.** Step 10.

### Step 17 — Notifications beyond the app

In-app expiry landed in Step 9, derived rather than stored (D30). This step is
the pluggable delivery half (D13), and it is where the `notifications` table
finally gets a writer — because a thing that has been sent needs a record saying
so. No notification on any channel may contain document contents, file names or
field values: an expiry reminder says a document is expiring and says to open
Safehouse. Delivery failure is itself visible in the app, because a silently
broken relay must not silently disable alerts. Break-glass activation alerts
the admin (D19).

**Landed** (D37).
- **Break-glass:** an emergency contact opens their own window from the
  dashboard, with a reason. A trigger alerts every active admin in the same
  transaction, and the admin closes it from the access console. Migration 0015
  holds the rules.
- **Delivery:** one channel, `SAFEHOUSE_NOTIFY_WEBHOOK`. A sweep runs at boot
  and every 15 minutes; it writes `expiry.soon` rows for admins, once per
  document, and delivers anything undelivered. A break-glass alert goes out at
  once.
- **Visible failures:** every attempt is recorded on its row, and the
  dashboard warns about failed deliveries and about a sweep that has stopped.

**Acceptance, as met.**
- `app/db/emergency.test.ts`:
  - only an emergency contact opens a window, only for themselves, with a
    reason, not backdated and not over the setting;
  - the admins' alert is written by the database;
  - only an admin closes one, in their own name; nobody extends one; nothing
    is deleted;
  - four mutations, including a trigger that does nothing, each turned a test
    red.
- `app/db/notifications.test.ts`: one reminder per document, never for
  somebody else, never about a document they cannot see. The application
  cannot forge an emergency alert. Delivery errors are short, and nothing is
  deleted.
- `app/db/notify.test.ts`, against a local HTTP server:
  - every message is checked for titles and names;
  - a second sweep sends nothing;
  - HTTP 502 and a timeout are recorded as statuses, never the far end's body;
  - retries stop at five, and an unreachable URL is not quoted in the error.
- In a browser, with a local webhook:
  - five messages went out on the first sweep;
  - Lapsed opened a window, reached 10 medical and legal documents, and Priya
    was alerted at once;
  - Priya saw the reason on the dashboard and closed the window; both acts
    are in the log.

**Not done.** Email (SMTP needs a dependency). Members' reminders outside the
app. Upload and access-change alerts and the weekly digest (D13 lists them;
nothing writes them yet).

**Size.** M. **Depends on.** Steps 9, 16.

### Step 18 — First run for an empty household — *deferred*

Everything above assumes a seeded fixture. A household installing this for the
first time has an empty database, no tree, and no documents.

Deferred by the household that owns this one: it is being built for a vault
that already exists and already has its administrator. Picked up if Safehouse
is ever installed somewhere else.

**Size.** L. **Depends on.** Steps 10, 11, 15.

### Step 19 — Operations — **done**

Upgrade path across schema changes on a live vault with real documents in it;
the restore drill from Step 6 on a schedule; what to do when the key file is
lost (nothing — say so, loudly, before it happens rather than after).

**Landed** (D38). `docs/OPERATIONS.md` is the runbook: what to keep, the key,
backups on a schedule and off the machine, upgrading and going back, putting a
vault back, and a lost second factor. `npm run upgrade` runs backup, drill and
migrate in that order. A passed drill records itself in the vault, and the
admin's dashboard warns when the newest proven backup is over eight days old.
The dashboard also asks, until an admin answers for the current key, whether
the key is written down somewhere else. The documents moved to a host
directory so that backups reach them, and the server refuses to start when it
cannot write there.

**Found on the way.** Two bugs, both fixed:
- **Restores came back without their grants.** Backups were dumped without
  privileges, so a restored vault refused the app everything and nobody could
  sign in. The drill had passed, because it read the copy as the owner.
- **Compose backups held no documents.** The store was a Docker volume that
  `npm run backup` on the host could not see.

**Acceptance, as met.**
- `app/db/safekeeping.test.ts`:
  - drills are read by an admin and nobody else, and written by nobody the app
    connects as;
  - the key copy is a key id and nothing else, set by an admin only;
  - overdue is measured by when the backup was taken;
  - a confirmation counts for its own key only;
  - mutations turned tests red: the read policy, the key-id check, a
    staleness measured by drill date, and any key counting. The read policy
    and an insert grant are also refused by the migration's own pinned check.
- **The drill:** an old backup fails it, by name. A new one passes, and its
  pass shows on the dashboard.
- **A restored copy's privileges:** the two app roles' privileges were
  compared line by line with the live vault and are identical, 140 each, with
  no `perm` USAGE.
- **`npm run upgrade`** ran on the dev vault across the migration that added
  `backup_drills`, drilling before the table existed.
- **The container:**
  - it ran as uid 1000 against the bind-mounted store, and served sign-in;
  - pointed at a directory it could not create, it refused to start and said
    why.
- **In a browser:** an aged drill and the key reminder both showed. Pressing
  the button recorded the key id and logged it, and the reminder went.

**Not done.**
- **A command to check a written-down key** against the file.
- **A screen for a lost second factor.**
- **A webhook alert for an overdue drill.** It is on the dashboard only.

**Size.** M. **Depends on.** Step 6.

---

### Step 20 — Every paper a PDF, to scale; the vault as folders — **done**

Imports become drafts (intakes) reviewed before filing: photographed pages
straightened onto their corners and drawn at the real size, pages from several
uploads joined and ordered, OCR fields corrected, then one checked PDF filed.
Older image documents are converted the same way. `/folders` browses the vault
as Person / Category / paper and downloads a selection as one ZIP.

Spec: `docs/specs/pdf-intake-and-folders.md`. Decisions: D39, D40, D41.

**Landed.** Migration `0017_intakes` (three draft tables, policies, the write
surface restated). `app/paper.server.ts` finds a photo's corners with OpenCV,
warps it flat at 300 dpi to its real size, builds one PDF with the originals
attached, and reads it back to check every page's size. Upload and bulk make
drafts; `/intake/:id` reviews them, with a corner editor; `/unfinished` lists
drafts and papers still filed as images, which convert into a PDF as the next
version; `/folders` browses and downloads a ZIP.

**Acceptance, as met.**
- `app/db/intakes.test.ts` (17): the uploader and an admin reach a draft;
  another member, a third party and an emergency contact do not; a draft
  cannot be started in somebody else's name, handed to them, or pointed at an
  owner out of reach. Loosening the read and start policies turned 9 red.
- `app/paper.server.test.ts` (13): a drawn card found to within 12 px,
  flattened to exactly 1011 × 638 px with its mark in the right corner; pages
  built at their sizes in points; a PDF that is not what was asked for refused.
- `app/db/intake-flow.test.ts`: a photographed card filed as one page of
  85.6 × 54 mm with the photo attached and its fields confirmed; a typed
  field never overwritten by the reader; an old image converted into
  version 2, version 1 kept.
- `app/db/folders.test.ts`: the tree is the vault list; ZIP paths cannot
  escape or collide; one id out of reach refuses the whole ZIP and records
  nothing.
- **In a browser**, as a member: an angled photo of a fictional card was
  found, guessed as an ID card, filed, and downloaded as one page of exactly
  85.60 × 54.00 mm; the same paper came back in a ZIP under
  `Maya Adeyemi/General/`. At 390 px nothing scrolls sideways.
- **The drill** passed on a backup taken after the migration, grants included.
- **Scanned PDFs read, and every built PDF searchable** (D39). In the app
  container, with Tesseract 5.5.2: a fictional scanned A5 PDF with no text
  layer had its expiry read; filed together with a photographed card, the
  PDF came back as 148 × 210 mm and 85.6 × 54 mm pages, both searchable,
  photo attached. `pdf-pages.server.test.ts` and `paper.server.test.ts`
  cover drawing pages and laying words over them.
- **Two drafts converting the same paper** (D42, migration `0018`): the second
  to be filed is stopped and shown both versions side by side. Tested in
  `intake-flow.test.ts` (a stale "file over" is refused too; removing the
  check turns it red) and in a browser, where filing over made version 3.

**Not done.**
- **A turned scan gets no text layer.** A PDF page with its own /Rotate is
  filed without one, since its words would sit crosswise.
- **HEIC.** Refused; an iPhone sends JPEG when the page does not ask for HEIC.

**Size.** L. **Depends on.** Steps 8, 15.

---

## Decisions that gate steps

| Decision | Gates | Cost of leaving it |
|---|---|---|
| Open question 4 — does a per-record grant carry its owner's name | Step 7 | A third party cannot tell two identically-titled documents apart |
| ~~Which local reading engine~~ | settled | D27: Tesseract as a system package, with the PDF text layer read before it |
| Open question 5 — is the admin's reach the right denominator | settled | D34: yes, worded "of the M you can see", and shown to admins only |
| D14's alternative — encrypted values plus keyed fingerprints | settled: D35 | Choosing it after search ships is a migration rather than a design |
| Open question 6 — fixture size | settled | Thirty-six documents, and Rose reaches fourteen of them |

## Not in this roadmap

Multi-tenancy (D2 settles it), mobile applications, sharing outside the
household, and running a mail server (D13 settles it). None of them are
prerequisites for anything above.

Sending a document off this machine to be read more accurately is deliberately
absent rather than forgotten: D26 allows it only as a per-document choice with
its own spec, and no such code exists. Until it does, the vault cannot send a
document anywhere, which is a stronger guarantee than a setting that defaults
to off.
