# Architecture Decisions

Each entry records **what was decided and why**. The "why" matters more than the
"what" — without it, a future session will helpfully refactor away something
that was load-bearing.

Format: decision, reasoning, consequences. Add new entries at the bottom.
Mark superseded decisions rather than deleting them.

---

## D1 — Permissions resolve on the server, always

**Decided.**

The server never sends a document, record field, or file the requester isn't
entitled to see. The client does no access-control filtering.

**Why.** A filter in the UI is presentation, not security — anyone who opens
devtools sees everything the server sent. For an application holding passports
and wills, "the UI hides it" is not an acceptable answer.

**Consequences.**
- Masked fields (passport numbers, license numbers) must be masked or omitted in
  the API response, not just in the component.
- View-as mode is computed server-side, with the server independently verifying
  the requester is an admin. A client-side view-as flag is a backdoor with a
  nice banner.
- Break-glass activation, its time window, and the admin alert are all
  server-enforced and server-timed.
- File downloads go through an authorizing endpoint. No guessable direct paths,
  no long-lived public URLs.

---

## D2 — One household per deployment; not multi-tenant

**Decided.**

Each family runs their own instance with their own database. There is no
household switcher, no signup flow, no shared database with a `household_id`
discriminator.

**Why.** The stated goal is personal use, with the option to deploy an empty
instance for another family later. Physical separation gives that for free and
removes an entire class of catastrophic bug — a tenancy leak in a document vault
is not a bug you recover from reputationally. It also avoids paying multi-tenant
complexity now for a maybe-later.

**Consequences.**
- Deployment is the tenancy boundary. Provisioning a new family = new container
  + new database.
- If this ever becomes a hosted product, "you get your own isolated instance" is
  the pitch, not a limitation.
- Revisit only if per-instance operational cost becomes the bottleneck. That is
  a long way off.

---

## D3 — Self-hosted, Docker Compose

**Decided.**

Postgres for structured data, local disk for document files, orchestrated with
Docker Compose. No managed cloud services in the critical path.

**Why.** Stated preference, and it fits the product: the whole appeal of a
household vault is that the documents are *yours* and not on someone else's
infrastructure.

**Consequences.**
- Backups are entirely on you. See D6.
- Certificate management, updates, and uptime are on you.
- No dependency on a vendor's auth or storage service means those must be
  solved deliberately. See D4 and D5.

---

## D4 — Do not hand-roll auth or crypto

**Decided.**

Authentication, session handling, password storage, and encryption all use
maintained, widely-audited libraries. No custom implementations.

**Why.** These are the two areas where a subtle mistake is invisible in testing
and catastrophic in production. Solo-built auth for a passport vault is not a
reasonable risk.

**Open:** which specific solution. Constraint: must work self-hosted with no
external identity provider dependency.

---

## D5 — Documents encrypted at rest

**Decided.**

Document files are encrypted on disk. The encryption key is not stored beside
the encrypted data.

**Why.** Self-hosting means the disk is a real attack surface — a stolen drive,
a misconfigured volume mount, or a leaked backup should not equal a leaked
passport. Encryption at rest turns a storage breach into a non-event.

**Open:** key management approach. This is the decision most likely to be got
wrong quietly, and is worth a dedicated planning session.

---

## D6 — Backups are part of the product, not an afterthought

**Decided.**

Automated, tested, off-machine backups of both database and document storage
before the vault holds anything real.

**Why.** A vault you can lose is worse than a drawer — the drawer at least
doesn't create false confidence. A backup that has never been restored is not a
backup.

**Consequences.**
- Backup encryption is required (a plaintext backup defeats D5).
- Restore must be tested on a schedule, not assumed.
- This blocks putting real family documents in. Do not skip it and plan to
  circle back.

---

## D7 — Seed and test data is always fictional

**Decided.**

No real personal data enters development, test fixtures, or seed files. Not
real passport numbers, not real family scans, not "just my own."

**Why.** Real data in a dev environment ends up in a screenshot, a log line, a
commit, or a bug report. A fictional household is sufficient — see the seed data
described in `PRODUCT.md`.

---

## D8 — The prototype is reference, not foundation

**No longer applicable.** *(Voided 2026-08-22. Kept because the reasoning still
governs anything that replaces it.)*

There is no prototype. `reference/prototype/` does not exist and never entered
this repository, so nothing carries its architecture forward and the read-only
boundary it described has been removed from `CLAUDE.md` and `README.md`.

**Why this entry stays.** The rule it stated still applies to any future
reference implementation, mockup, or borrowed code dropped into this repo: its
behaviour and data shape may be useful, its architecture is not to be adopted.
A session-only mockup with client-side permission filtering is precisely what D1
forbids, and code sitting in the repo is the strongest structural signal
available — it gets copied unless something says not to.

---

## D9 — TypeScript end to end, React Router v7, one container

**Decided.**

The application is TypeScript on both sides, built on React Router v7 in
framework mode, served from a single Node container alongside Postgres. Drizzle
for schema and migrations, with raw SQL wherever a query expresses a permission
rule.

**Why.** The maintainer does not write code; the practical question is not which
stack is most elegant but which one an AI assistant is least likely to get
quietly wrong. TypeScript has the deepest tooling for catching mistakes without
a human reviewer, and one language across client and server halves the surface.

React Router v7 was chosen over Next.js specifically because of D1. In an RSC
application, accidentally passing an unmasked record object into a client
component ships it to the browser inside a serialized payload — the page looks
perfect and the leak is visible only in devtools. In React Router, everything
that reaches the browser passes through one explicit loader per route, which can
be called directly in a test and asserted against. An auditable boundary beats a
discipline that has to be sustained across every future session.

Django was seriously considered and is the stronger option on "someone else
maintains the hard parts". It lost on the product's interactivity: the pan/zoom
family tree, view-as, and the bulk triage surface are real client applications,
so the JavaScript comes back as islands and Django's advantage is paid for
twice — once in the second language, once in the glue between them.

**Consequences.**
- Drizzle is chosen for migrations and typed queries, not as an abstraction to
  hide SQL behind. Permission logic lives in SQL that can be read on its own.
- No Redis, no separate worker, no second service unless something genuinely
  cannot work without it. Every extra container is a failure mode the maintainer
  cannot debug from a shell.
- The React Router major version is a dependency to hold still deliberately.
  Upgrade on purpose, never incidentally.

---

## D10 — Authentication by library, inside the application

**Decided.** Resolves the "which solution" question left open in D4.

Email-and-password sign-in with TOTP two-factor and optional passkeys, handled
by a maintained auth library (Better Auth is the current candidate), with
sessions stored in the application's own Postgres. No external identity
provider, and no separate identity container.

**Why.** D4 forbids hand-rolling this, and D3 forbids depending on a hosted
identity service. That leaves two shapes: a library inside the app, or a
self-hosted identity server such as Keycloak, Authentik or Zitadel speaking
OIDC.

The identity-server route was rejected on weight. It is a second heavyweight
service to run, upgrade and back up for a household of roughly eight people, it
splits invites and user management across two systems, and it does not remove
the part that actually matters: Safehouse's four roles are application concepts
that live in the application's database either way.

Auth.js's credentials provider was rejected because it is deliberately minimal —
password reset, lockout and 2FA end up hand-written around it, which is D4
violated by accretion rather than by decision.

**Consequences.**
- The four roles (admin, individual, third-party, emergency) are Safehouse's own
  data and are never delegated to the auth library's own role system.
- Revealing a masked field and downloading a file require a step-up
  re-authentication, not merely a valid session.
- The Settings screen's "biometric / PIN / auto-lock" are client conveniences.
  The actual security is a short session lifetime plus server-side re-challenge;
  auto-lock must never be the only thing standing between a borrowed laptop and
  the vault.
- The specific auth library is the one dependency worth re-verifying at scaffold
  time rather than assuming from this document.

---

## D11 — The database enforces permissions, not just the application

**Decided.** Strengthens D1.

Document visibility is expressed once, in SQL, as a named view — every list,
search and download resolves through it and there is no other supported path to
fetch documents. Postgres row-level security is enabled on the document, record
and file tables, with policies built on that same expression.

**Why.** D1 says permissions resolve on the server. That is necessary but, with
no human reviewing changes, it is not sufficient: the realistic failure is not a
filter in a React component, it is a new query in a future session that simply
forgets to join the permission view. Application-level enforcement makes that
mistake silent and invisible. Row-level security makes it loud — the forgotten
check yields zero rows and a visibly broken page instead of a leak nobody
notices.

**Consequences.**
- The current user is set per transaction. Connection pooling must be configured
  so that setting cannot leak between requests; this is the one piece of
  plumbing worth testing explicitly.
- View-as mode sets the *viewed* user for the transaction while the server
  independently verifies the requester is an admin, per D1.
- The permission test suite is the primary safety net for this project and runs
  on every change. CLAUDE.md's "write the test for a permission rule before the
  rule" is not a style preference here; it is the review process.
- Admin access is an explicit policy, never a superuser connection that bypasses
  RLS.

---

## D12 — Envelope encryption, key in a file the server reads at boot

**Decided.** Resolves the key management question left open in D5.

Every document file gets its own randomly generated data key (AES-256-GCM). Each
data key is encrypted with a single key-encryption key and stored, wrapped,
beside the document row. The key-encryption key lives in a file mounted into the
container as a Docker secret — never in the database, never in the document
storage volume, never in a backup.

**Why.** Envelope encryption is the part worth committing to regardless: it
makes key rotation possible without re-encrypting every file, and it turns
"where does the key live" into a swappable detail rather than a decision welded
into the schema.

For where the key lives, the choice was between a key file the server reads
unattended and a passphrase typed at an unlock screen after every restart. The
passphrase additionally defends against theft of the physical machine, at the
cost of the vault being dark after every power cut and update until someone is
at a browser — including while away from home, which is exactly when a household
member is most likely to need a document urgently. The leak that realistically
happens to a household is a backup on a laptop, a discarded disk, a volume
snapshot, or a stray copy of a folder, and the key file covers all of those. OS
level full-disk encryption covers most of the rest and is simpler to operate.

End-to-end encryption under per-user password keys was considered and rejected:
it breaks server-side search, admin view-as, shared household documents,
previews, and account recovery, and is in direct conflict with the product.

**Consequences.**
- Passphrase-unlock remains available as a later configuration change. The key
  provider is an interface with one implementation now; adding the second must
  not require touching the schema.
- The key file is excluded from every backup path by construction, and losing it
  means losing every document. Its own custody — printed, offline, somewhere
  else — is part of the D6 backup work, not an afterthought.
- Key rotation re-wraps data keys only. It never rewrites document files.

---

## D13 — Notifications are in-app first, with pluggable delivery

**Decided.**

Every notification — expiry warnings, upload alerts, access alerts, break-glass
activation, the weekly digest — is written to the database and shown in the app.
Delivery to the outside world is an optional adapter: SMTP when a mail account
exists, and a push endpoint (ntfy, a Telegram bot, or any webhook) that needs no
mail server at all.

**Why.** The deployment may not have working outbound email, and building for
in-app only would mean retrofitting a notification layer later — expensive —
while requiring SMTP up front adds a service that can silently stop working
without anyone noticing. One notification layer with swappable channels costs
almost nothing now and closes both problems.

Break-glass is the one case where delayed notice genuinely matters: learning
that an emergency contact opened the vault the next time you happen to visit the
app is not good enough. A push webhook covers that without a mail server.

**Consequences.**
- Invites and password resets work without email: the admin generates a
  single-use link and delivers it by hand. Email, when configured, sends the
  same link.
- No notification, on any channel, may contain document contents, file names, or
  record field values — see CLAUDE.md. An expiry reminder says a document is
  expiring and to open Safehouse. It never says which number is expiring.
- Delivery failure is itself visible in the app. A silently broken mail relay
  must not silently disable alerts.

---

## D14 — Record field values are readable in the database

**Decided.**

Passport numbers, licence numbers and similar identifiers are stored as ordinary
readable columns. They are masked in API responses per D1, and the protection
against disk and backup theft comes from D5, D6 and D12 rather than from
column-level encryption.

**Why.** The product supports finding a document by part of its number, and a
partial match is impossible over encrypted or fingerprinted values. This was an
explicit trade, chosen with the cost stated.

**Consequences — the accepted risk, and what it obliges.**
- A copy of the database is a copy of every identifier in the household. This
  makes three things load-bearing rather than optional: backups are encrypted
  (D6), Postgres is never reachable outside the container network, and every
  reveal of a masked field is written to the activity log.
- Considered and available if this is revisited: store the value encrypted
  alongside keyed fingerprints of both the full normalized number and its last
  four digits. That preserves whole-number search and the most common partial
  search, and yields nothing from a stolen database. It cannot support arbitrary
  substring search.

---

## D15 — Owners, people and users are three different things

**Decided.**

`owners` holds everything a document can be filed to: a person, a business, or
the household itself, distinguished by a `kind` column. `users` holds everything
that can sign in, with a nullable link to the person they are.

**Why.** The household's marriage certificate has to belong to *something*, and
making the household a fourth concept means every query in the application
carries a special case for it. One owners table makes "documents belong to an
owner" true without exception.

Separating users from people matters just as much in the other direction: the
estate attorney signs in but has no place in the family tree, and a child may
sit in the tree with no login at all. Collapsing the two breaks both, and it
breaks them at the point where access is decided.

**Consequences.**
- A document row carries exactly one `owner_id`. There is no nullable
  "household document" flag.
- The auth library's own tables (sessions, credentials, second factors) sit
  beside `users` and are the library's business, not Safehouse's.
- Deactivating a user never deletes a person. Ruth stopping using the app must
  not remove her from the tree or orphan her documents.

---

## D16 — Tree relationships are typed and dated; the circle is a view

**Decided.**

Relationships are stored as edges between people. Only what cannot be inferred
is stored: `parent_of` and `spouse_of`. Siblings are derived from a shared
parent. Every edge carries `started_on` and a nullable `ended_on`, and parent
edges carry a type — biological, adoptive, step, or guardian.

The derived family circle is a single named SQL view, `visible_owner(user_id,
owner_id)`, computed live. Every query joins it; nothing recomputes it in
application code.

**Why.** Real families divorce, remarry, adopt and take on guardianship, and a
tree that cannot represent that is a tree the household will quietly stop
trusting. Dating the edges is the part that is nearly free now and close to
impossible to add cleanly later, because once undated edges exist there is no
way to recover when any of them started.

Storing sibling edges was rejected: with both parent and sibling rows stored, the
day arrives when they contradict each other and nothing indicates which is true.

For the circle itself, the choice was between recomputing per request, keeping a
materialised table rebuilt on tree changes, and a live view. The materialised
table is faster and pleasantly inspectable, but its failure mode is the worst
one available here — a missed rebuild means stale rows, and stale rows mean
someone silently retains access they should have lost. At household scale the
live view costs nothing measurable, and if it ever did, it can be swapped for
the materialised table without a single caller changing.

**Consequences — the access rules that fall out.**
- Ending a marriage sets `ended_on`. The ex-spouse and the ex-spouse's parents
  leave the circle from that date; keeping them requires a deliberate grant.
  Shared children are unaffected, because parent edges do not end.
- Biological and adoptive parent edges are identical for access. **Step edges
  confer no automatic access** — a step-parent needs an explicit grant. Over-
  granting is the failure that matters here, and a grant is one click.
- **Guardian edges act as parent edges while active** and lapse on `ended_on`.
- A deceased person keeps their owner row and their documents — this is the
  moment the wills matter most. Their circle continues to see them.
- Changing which access a step or guardian edge confers is an edit to one view,
  not a migration.

---

## D17 — Any document can be marked private

**Decided.**

A record can be flagged private. A private record is visible only to its owner
and to the household admin. It is excluded from the derived family circle and
from category-based third-party grants; reaching it requires an explicit
per-record grant.

**Why.** The circle is the right default — that is what makes the product work
without a configuration screen — but it produces one genuinely bad outcome: a
parent seeing an adult child's medical correspondence merely because the tree
says parent. Restricting the whole Medical category instead was considered and
rejected, because a parent frequently *does* need a child's immunisation record,
and a rule that blocks the common case to catch the rare one gets worked around.
One flag on one record handles the therapy letter and the sealed will with the
same mechanism.

**Consequences.**
- Privacy is from family, not from the admin. The admin runs the server and can
  read the disk regardless, so claiming otherwise in the UI would be a lie. The
  interface must say who can still see a private document.
- **Break-glass is the deliberate exception**: an active emergency window reaches
  private records in the critical categories. A private advance directive hidden
  during a medical emergency defeats the entire reason the feature exists. Every
  such access is logged and alerted, per D13.
- Because every uploaded file belongs to a record, per-document privacy is
  available in practice without a second flag.

---

## D18 — Third-party grants are two independent lists

**Decided.**

A third-party user is granted a set of owners and, separately, a set of
categories. They see the intersection. The bookkeeper granted Hale Consulting
LLC plus Financial and Business sees exactly those; the attorney granted the
family plus Legal sees exactly those.

**Why.** It matches how the grant is actually reasoned about — *whose* papers and
*what kind* — and it is the version that can be displayed honestly in one screen
and understood at a glance. Per-owner category lists express more, at the cost of
a fiddlier console and more ways to grant something by accident.

**Consequences.**
- Grants are stored as two tables, owners and categories, not as a precomputed
  cross product. The intersection is computed in the same view as everything
  else.
- The case this cannot express — "the LLC's finances, but only Daniel's tax
  returns" — is handled by the per-record grant that D17 already requires. If it
  becomes common rather than exceptional, revisit.
- A grant never reaches a private record (D17) and never reaches a category the
  user was not granted, regardless of owner.

---

## D19 — Emergency access carries its own expiry

**Decided.**

Breaking the glass writes an activation row with its own `expires_at`. The
window length is a household setting defaulting to 24 hours, with a hard ceiling
in the code. The admin can revoke early; nobody can extend beyond the ceiling.

**Why.** Each activation needs a stored expiry regardless — the window must be
server-timed per D1, not counted in the browser — so making the duration a
setting costs one column and one settings field. Leaving it open until the admin
closes it was rejected: break-glass exists precisely for the situation where the
admin is unreachable, so "the admin closes it" is a design that fails in its own
use case.

**Consequences.**
- Expiry is enforced by comparing to the database clock inside the permission
  view. There is no scheduled job that "closes" windows, and a job failing to run
  can therefore never leave one open.
- Activation, every access made during the window, revocation and expiry are all
  written to the activity log and alerted per D13.
- The ceiling is a constant in code, not a setting. A setting that can be raised
  without limit is not a ceiling.

---

## D20 — Records hold dated documents; documents hold pages

**Decided.**

Three levels, matching the product's own vocabulary. A **record** is the card —
*Maya's passport*. A **document** is one dated scan of it — the 2014 issuance,
the 2024 renewal — carrying that version's structured fields. **Document files**
are its pages.

Fields that drive features are real indexed columns: issue date, expiry date,
issuing country, identifier, place of issue, and where the physical original is
kept. Everything else lives in a JSON column per record kind.

**Why.** A "series key" — a string that documents share in order to collapse
into one card — is a join waiting to be broken by a typo, with no way to detect
the break. Making the series an actual row means a renewal cannot fail to attach
to the thing it renews.

The field split follows what is queried. The expiring-soon list and search by
number need indexed columns; the long tail of per-kind detail does not, and
should not cost a migration each time a new record kind appears. Typed columns
for every kind was rejected as a migration per document type; a single JSON blob
was rejected because the two queries the product is built around would both have
to scan it.

**Consequences.**
- Every uploaded file belongs to a record, with a bare General record created
  automatically on upload. This keeps the vault grid one query rather than a
  union of records and loose documents. A 200-file bulk intake therefore creates
  200 records, which is the intended card model rather than an accident.
- Renewal marks the previous document superseded rather than deleting it. Only
  one document per record is current.
- Each file row carries its own wrapped data key per D12, so encryption is a
  property of the file, not of the record.

---

## D21 — Access console: per-user panel primary, matrix as audit

**Decided.** Resolves the first open question in `PRODUCT.md`.

The per-user detail panel is the default and the only place grants are edited.
The matrix ships as a read-only audit view.

**Why.** They answer different questions. Editing access is always about one
person — what can the bookkeeper reach — and the panel is shaped like that
question. The matrix answers "is anything wrong anywhere", which is checking,
not doing. A grid of editable cells is also the interface most likely to produce
an accidental grant from a mis-click, and this is not an application where that
is a small mistake.

**Consequences.**
- The matrix is genuinely read-only. Clicking a cell opens that user's panel.
- Both views read the same permission view as the vault itself, so neither can
  disagree with what the user actually sees.

---

## D22 — The application connects as a role that cannot bypass permissions

**Decided.** Implements D11.

There are two database roles. `safehouse` owns the tables and runs migrations;
it bypasses row-level security, because it has to in order to create it.
`safehouse_app` owns nothing, and is what the running application connects as,
so every policy applies to it. The owner password is not present in the
application container at all.

Each request sets `safehouse.user_id` for the duration of one transaction, and
every policy is written against `current_app_user()`.

**Why.** Row-level security does nothing for a connection that owns the tables —
Postgres exempts the owner, and the postgres image's default user is a
superuser besides. Connecting as the owner and remembering to switch roles per
request would have worked too, and was rejected: if the switch is ever missed,
the query runs with everything visible. With a separate role, a missed step
leaves `current_app_user()` null, no policy matches, and the query returns
nothing.

That asymmetry is the entire argument. In a project where no human reads the
diff, the mistakes have to land on the side where they show up as a blank page.

**Consequences.**
- Two credentials in `.env`, and a first-run step: `npm run db:migrate` creates
  the role before applying migrations.
- Only `select` is granted. Writing is not implemented, and a table with no
  write policy refuses writes rather than allowing them.
- A table added by a later migration is readable but returns nothing until it is
  given policies. A test asserts every table in `public` has row-level security
  switched on, so the omission fails in the suite rather than in the vault.
- Anything that must legitimately see across users — seeding, backup, an admin
  repair — runs as the owner, deliberately and by hand.

---

## D23 — The household's own papers are shared; a business is reached by grant

**Decided.**

Records owned by the `household` owner — the deed, the marriage certificate,
the home insurance — are visible to every individual in the household. Records
owned by a `business` owner are visible only to the admin and to whoever is
granted that owner by name, including the family member who runs it.

**Why.** The household is the deployment (D2), and its shared paperwork is
shared by definition; hiding the deed from the spouse who lives behind it would
be a rule nobody asked for. A business is the opposite case: nothing in the
family tree says who runs it, and inferring it from a marriage would hand a
spouse the company's tax returns by accident. One grant, made once, says it
properly.

**Consequences.**
- `visible_owner` has an explicit household branch. Narrowing it later is an
  edit to one view.
- Setting up a business is a two-step job: create the owner, then grant it to
  whoever should see it. The interface should say so at the point of creation,
  because the failure mode is a business whose papers nobody but the admin can
  find.
- A private record on a business owner is reachable only by the admin, since a
  business has no person to be its owner. If that becomes a real need, the
  per-record grant already covers it.
---

## Open decisions

None. D9–D21 closed the list that stood here; D22 and D23 record what building
the schema forced into the open.

Worth revisiting deliberately rather than by drift:

- **The auth library** (D10) — verify it is still the right choice at scaffold
  time rather than trusting this document.
- **Key custody** (D12) — passphrase-unlock is designed for and not built. Decide
  again once real documents are in and the operational rhythm is known.
- **Readable identifiers** (D14) — an accepted risk with a documented alternative,
  not a closed question.
- **Per-owner category grants** (D18) — revisit if the per-record exception stops
  being exceptional.
