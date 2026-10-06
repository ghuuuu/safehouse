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
five `security definer` functions); sign-in, sign-out and first-run admin;
the vault list; view-as; a dev seed; the committed permission matrix.

Not built: everything that writes. There is **no write policy for the app role
on any vault table** — the only policies with `with check` belong to
`safehouse_auth` on the identity tables (`0003_identity_boundary.sql`). There is
no storage layer and no cryptography: `document_files` has `storage_key`,
`wrapped_dek` and `nonce` columns and nothing fills them.

In one line: **Safehouse can prove who may see what, and nothing can get in or
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

**New dependency.** A local engine, named and agreed before it is added
(CLAUDE.md), preferring a system package in the image over a bundled one.

**Acceptance.** A passport scan fills six fields with check digits verified; a
deliberately corrupted strip fills none and says why; no code path in the
extraction reaches the network, asserted rather than assumed; an unconfirmed
value cannot reach a reminder.

**Size.** L. **Depends on.** Steps 6, 7. Backups first, because extraction puts
far more of a household's identifiers into the database and D14's obligations
get heavier, not lighter (D26).

### Step 9 — What expires, and saying so

The first thing the extracted data pays for. A vault that knows a passport
expires in March and says nothing in January is a worse filing cabinet than a
drawer.

The machinery is mostly there: `documents.expires_on` has an index built for
exactly this question, `settings.expiry_reminder_lead_days` already says sixty,
and the `notifications` table exists with a policy over it. What is missing is
the query, a write policy for notifications, and somewhere to show them.

Expiry is read by comparing the database clock inside the view (D19's pattern)
rather than by a scheduled job — a job that fails to run is a reminder that
never arrives, and nobody notices a thing that does not happen. In-app first,
per D13; delivery elsewhere is Step 17.

Only confirmed dates count (D26).

**Acceptance.** A document expiring inside the lead window appears and one just
outside it does not — the fixture has that pair on purpose, at 89 and 103 days.
A document whose expiry nobody confirmed does not appear at all. No reminder
contains a document title, a file name or a field value (D13, CLAUDE.md).

**Size.** M. **Depends on.** Step 8.

### Step 10 — People: roster, invites, add-member wizard

Today the only account that can exist is the first admin through `/setup`. The
sign-up endpoint is admin-gated but has no interface, so every deployment is a
household of one. D13 says invites and password resets work without email: the
admin generates a single-use link and delivers it by hand.

The wizard is built around one sentence — *"___ is the ___ of ___."* — with the
root case as its own card (`PRODUCT.md` §Screens).

**Size.** L. **Depends on.** Step 3 (it writes people and relationships).

### Step 11 — The family tree

The app's primary navigation device, and real data rather than decoration: the
circle the access model derives comes from these rows (D16). Pan, zoom, click a
person, the vault below filters to them.

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

**Size.** M. **Depends on.** Step 8.

### Step 14 — Dashboard

The tree, expiring-soon, category overview, quick-search chips. The
expiring-soon list is Step 9's query, given a home.

**Size.** M. **Depends on.** Steps 9, 11, 13.

### Step 15 — Bulk intake

The triage surface for a large intake across people and categories at once. D20
is explicit that a 200-file intake creates 200 records, and that this is the
intended card model rather than an accident. Step 8 runs over each of them,
which is what makes a 200-file intake survivable.

**Size.** L. **Depends on.** Steps 3, 8.

---

# Act III — The parts that are not about documents

### Step 16 — Settings and security

Account, Security, Notifications panels. Two-factor, auto-lock interval, active
devices, and the emergency ceiling — which stays a constant in code, with the
setting able to be raised only up to it (D19).

**Size.** M. **Depends on.** Step 10.

### Step 17 — Notifications beyond the app

In-app landed in Step 9. This is the pluggable delivery half (D13). No
notification on any channel may contain document contents, file names or field
values: an expiry reminder says a document is expiring and says to open
Safehouse. Delivery failure is itself visible in the app, because a silently
broken relay must not silently disable alerts. Break-glass activation alerts
the admin (D19).

**Size.** M. **Depends on.** Steps 9, 16.

### Step 18 — First run for an empty household — *deferred*

Everything above assumes a seeded fixture. A household installing this for the
first time has an empty database, no tree, and no documents.

Deferred by the household that owns this one: it is being built for a vault
that already exists and already has its administrator. Picked up if Safehouse
is ever installed somewhere else.

**Size.** L. **Depends on.** Steps 10, 11, 15.

### Step 19 — Operations

Upgrade path across schema changes on a live vault with real documents in it;
the restore drill from Step 6 on a schedule; what to do when the key file is
lost (nothing — say so, loudly, before it happens rather than after).

**Size.** M. **Depends on.** Step 6.

---

## Decisions that gate steps

| Decision | Gates | Cost of leaving it |
|---|---|---|
| Open question 4 — does a per-record grant carry its owner's name | Step 7 | A third party cannot tell two identically-titled documents apart |
| Which local reading engine, and adding it as a dependency | Step 8 | Nothing proceeds; D26 settled where reading happens, not what does it |
| Open question 5 — is the admin's reach the right denominator | Step 12 | "N of M" quietly changes meaning the day an admin cannot see everything |
| D14's alternative — encrypted values plus keyed fingerprints | Step 13 | Choosing it after search ships is a migration rather than a design |
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
