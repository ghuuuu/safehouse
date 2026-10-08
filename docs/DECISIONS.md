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

The derived family circle is a single named SQL view, `perm.visible_owner(user_id,
owner_id)`, computed live. Every rule is written against it and nothing
recomputes it in application code — see D25 for how a query reaches it.

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
- `perm.visible_owner` has an explicit household branch. Narrowing it later is
  an edit to one view.
- Setting up a business is a two-step job: create the owner, then grant it to
  whoever should see it. The interface should say so at the point of creation,
  because the failure mode is a business whose papers nobody but the admin can
  find.
- A private record on a business owner is reachable only by the admin, since a
  business has no person to be its owner. If that becomes a real need, the
  per-record grant already covers it.
---

## D24 — Signing in gets its own database role, with no reach into the vault

**Decision.** A third Postgres role, `safehouse_auth`, is the only thing the
sign-in code connects as. It can read and write `users`, `sessions`, `accounts`
and `verifications`, and it has no privilege of any kind on records, documents,
files, or anything else. The application's own role, `safehouse_app`, is refused
`accounts`, `sessions` and `verifications` in return.

Sign-up is not a public endpoint. It answers on a fresh install, to create the
first admin, and afterwards only when an admin is asking. Alongside that, an
account with nobody attached to it reaches no owner at all: the household branch
of `perm.visible_owner` now requires a person, so the seconds between "account
created" and "attached to a person in the tree" are not a window into the house.

**Why.** Checking a password is the one operation that has to happen before
anyone knows who is asking. Row-level security cannot express it — there is no
current user yet to write a policy against — so the choice was to punch a hole
in the policies for the app role, or to give that one operation a connection of
its own. A hole in the policies is permanent and applies to every query; a
separate role applies to one file.

What it buys is a shape rather than a rule. The half of the system that talks to
unauthenticated strangers, parses their JSON and compares their passwords is
also the half with no way to read a will. An attacker who owns the sign-in path
completely still has to find a second bug to reach a document.

The sign-up gate is the same reasoning one level up. As shipped by the library
the endpoint is public, and for a household vault a stranger with an account is
a stranger inside the building. Two locks, because the first one is a
configuration flag and configuration flags get flipped.

**Consequences.**
- Three roles now, with three passwords: owner (migrations only), app, auth.
  `npm run db:setup` creates the two restricted ones; `.env.example` lists them.
- Adding a table means deciding, in writing, whether the auth role gets it. The
  migration starts with `revoke all ... from safehouse_auth`, so the default is
  no.
- A password hash cannot come back through an ordinary application query, even
  the admin's, because the app role cannot read `accounts` at all.
- Creating the first admin is a first-run job, not a form anyone can reach. If
  every admin account is lost, the recovery is a command on the server.
- The permission views remained readable by the app role, because Postgres
  requires SELECT on a table a policy refers to. The views hold ids, not
  documents, so it was a smaller surface than it sounds — but it was not
  nothing, and writing it down here rather than leaving it to be discovered is
  what led to D25, which closes it.

---

## D25 — The rules are in a schema the application cannot reach

**Decision.** The nine permission views live in a schema called `perm`, and
neither `safehouse_app` nor `safehouse_auth` has USAGE on it or SELECT on
anything in it. The policies no longer name a view. They call five functions —
`perm.visible_owner_ids()`, `perm.visible_record_ids()`,
`perm.visible_document_ids()`, `perm.visible_file_ids()` and
`perm.current_user_is_admin()` — which are `security definer`, take no
arguments, and answer only about whoever the current transaction says is asking.

**Why.** D11 put the rules in views that read the base tables with row-level
security bypassed; that is what stops a policy defined in terms of a view from
recursing into itself. But Postgres insists that whoever runs a query holds
SELECT on every relation the policy expression mentions, so the app role had to
be granted SELECT on those views — and could then simply read them. `app_user`
is every account and its role. `visible_record` is the entire who-can-see-what
graph. Not a document, not a passport number, but the shape of the household
and who is entitled to what, available to any bug that could reach a query.

Two locks rather than one, because the household is meant to survive a session
that does not read the diff. Moving the views out of `public` means no
schema-wide grant on `public` can ever reach them again — and the statement
that caused this, `grant select on all tables in schema public`, is exactly the
line a future migration will copy when it adds a table. Revoking SELECT outright
means that even a well-meant `grant usage on schema perm`, typed to make a
permission-denied error go away, does not open anything.

The functions are where a mistake would hurt, so they are pinned in three ways.
They take no arguments: one that accepted a user id could be called in a loop
and would hand back the whole graph, which is the leak again with extra steps.
EXECUTE is revoked from PUBLIC, because Postgres grants it there by default and
that would give the rules to the sign-in role D24 spent its whole existence
keeping out. And every name in every body is schema-qualified, under a pinned
`search_path`, because a function body is re-resolved on each call against the
caller's path — a temporary table named `visible_record` would otherwise
substitute the caller's own answer for the database's, which would be worse
than the hole this closes. The app role is refused temporary tables as well.

**Consequences.**
- Opening a document still works exactly as before. The rules did not change;
  only the route a policy takes to reach them.
- A permission rule is still one view, edited in one place. Reading
  `drizzle/0001_permission_layer.sql` top to bottom is still how you learn what
  Safehouse allows.
- Nine assertions in `permissions.test.ts` are negative ones: each view is
  refused by name, the app role holds SELECT on no view anywhere, neither role
  has USAGE on `perm`, no definer function takes an argument or is callable by
  anyone else. Six mutations of the migration were checked against them, and
  each was caught by the test meant to catch it.
- The migration ends by asserting its own result and raising if it is wrong.
  Every step in it is silent when it half-works: a policy still naming a view, a
  revoke that missed, a default privilege left global. A migration that reports
  success and leaves the leak open is the failure this project cannot afford.
- What this does not fix: `safehouse.user_id` is an ordinary setting and any
  role may set it. Anything that can run arbitrary SQL as the app role can still
  name a user id and read that user's vault. What changed is that it must now
  already know an id — `users_read` gives out only your own — instead of reading
  the roster. Making the actor unforgeable is a larger change and should not be
  smuggled in here.
- Adding a tenth permission view means putting it in `perm` and giving it a
  function. The default privileges that would have made it readable are now
  scoped to `public`, and the test suite says so.

---

## D26 — Documents are read on this machine; sending one out is a per-document choice

**Decision.** Safehouse extracts structured fields from a scan — expiry date,
document number, issuing country, dates of issue — on the machine it is
installed on. Identity documents are read from their machine-readable zone, the
two lines of `<` at the foot of a passport or ID card, which yields surname,
given names, date of birth, nationality, document number and expiry with check
digits that say whether the read was clean. Everything else is read by a general
text engine running locally, which is adequate on a flat scan and poor on a
crumpled utility bill, and that limit is stated rather than papered over.

No document, page, or crop of one is sent anywhere else by default. If a better
reading of a messy document is wanted, that is a decision taken for one document
at a time: it names where the file is going, requires the step-up check a
download requires, is written to the activity log, and is never the default or
a setting that can be left on.

**Extraction is a suggestion, never an authority.** Every extracted value lands
as a proposal the household confirms or corrects. A value nobody has confirmed
is marked unconfirmed and is not used to decide anything — an expiry reminder
fires on a date a person agreed with, not on one an optical read guessed. A
failed MRZ check digit produces "could not read this cleanly", not a value.

**Why.** The whole product is one promise: this is your filing cabinet, in your
house, and it does not phone anybody (D3, D13). Posting a passport scan to a
third party to have it read undoes that promise more completely than any other
feature could, because it moves the exact thing the vault exists to protect, in
plaintext, to a machine the household does not control. A household that wanted
that trade already has Google Drive.

The case for sending documents out is real and it is about accuracy: a cloud
reader or a vision model is dramatically better on bills, letters, insurance
schedules and anything handwritten. It is weakest exactly where it would matter
most. Passports, ID cards and visas — the documents a household most wants
structured, searchable, and watched for expiry — carry a strip designed by
standards bodies for machines to read, and parsing it locally is close to
perfect and verifiable by its own check digits. The best case for the cloud is
the long tail; the local reader covers the head.

Rejected: cloud extraction as the default, because it contradicts D3 and D13 and
would make the vault's central claim false. Rejected: a local vision model
always running, because it is a second service with a GPU-shaped appetite on a
box that is meant to be a Raspberry Pi in a cupboard, and D9 permits a second
service only when something genuinely cannot work without it. Rejected:
extraction that writes fields directly, because an optical misread that silently
becomes a renewal date is worse than no extraction — it is a vault confidently
telling you the wrong thing.

**Consequences.**
- The fields exist already (`documents.issued_on`, `expires_on`,
  `issuer_country`, `identifier`, `place_of_issue`, plus `details` for whatever
  a document type needs). Extraction fills them; it does not design them.
- A confirmation state has to exist per field, so "nobody has checked this" is
  representable. That is a schema change and it comes with the Record screen.
- Whatever local engine is chosen is a new dependency and gets said out loud
  first (CLAUDE.md). A system package in the image is preferred to a bundled
  one.
- More extracted values in the database makes D14's obligations heavier rather
  than lighter: encrypted backups (D6), Postgres unreachable from outside the
  container network, and every reveal of a masked value logged. Extraction
  should not land before backups do.
- The outbound path, if it is ever built, is a new security surface and gets its
  own spec. Until then there is no code that can send a document anywhere, which
  is a stronger guarantee than a setting that defaults to off.

---

## D27 — Tesseract, and the text layer before it

**Decision.** The local reader D26 calls for is Tesseract 5, installed as a
system package in the image and driven as a subprocess. It is used at two call
sites: a cropped machine-readable strip read with an OCR-B model, and a whole
page read with the English model.

Before either of them runs, the PDF text layer is read. Most of what a
household files — utility bills, insurance schedules, tax returns, policies —
is generated digitally and already contains its text, exactly, with positions.
Reading that is instant, free and perfect, and OCR is the fallback for what was
genuinely scanned or photographed. Treating every document as an image is the
most expensive mistake available in this step.

Four packages come with it: `unpdf` (MIT) for the text layer, `mrz` (MIT, no
dependencies) for check-digit arithmetic that must not be hand-rolled, `sharp`
(Apache-2.0) for decoding and cropping, and `@hyzyla/pdfium` (BSD-3) later for
rasterising the scanned PDFs that have no text layer. No wrapper package around
the binary: every one is abandoned, and `execFile` with a timeout is shorter
than their documentation.

**Why.** Licence first, because it is what rules most of the field out. Tesseract
is Apache-2.0 for both the engine and the language models, uncontested for
twenty years, and survives this being sold to another household unchanged.
Against that: Surya, Marker and Chandra publish Apache-2.0 *code* with model
weights under a modified OpenRAIL licence that stops at a revenue or
funding-raised threshold — an automated licence check reports Apache-2.0 and is
wrong. MinerU carries revenue conditions. The actively-maintained purpose-built
MRZ readers are AGPL-3.0, which for a self-hosted application reaches the whole
server. The most-linked OCR-B model on the internet has no licence file at all,
which is not permission.

Then operations. Tesseract is one `apk` line, needs no GPU, no Python, no second
process and no network, and holds no memory at rest — it is a program that
starts, reads and exits. PaddleOCR is genuinely better on photographed and
skewed documents, and the Node runtime it needs has no musl build, so adopting
it means leaving Alpine. That cost is not worth paying for an engine whose
output a person confirms anyway.

A local vision model was rejected for a reason unrelated to its cost: it invents
characters, and does so more on digits than on words. A misread number from
Tesseract looks broken; a hallucinated one looks correct, and this is a vault.

**Consequences.**
- Tesseract is a frozen engine rather than an improving one, and that is
  accepted. Recent releases are build cleanups by essentially one maintainer.
  It will not get better and it will not break.
- Accuracy is mediocre on anything tilted — field recovery falls off a cliff at
  a few degrees of rotation. The answer is the upload screen saying so while
  the person is still holding the document, not a preprocessing pipeline.
- The engine stays behind one module, so replacing it is one file. If Alpine is
  ever abandoned for an unrelated reason, PaddleOCR in-process becomes a
  straight upgrade and should be revisited that day.
- The MRZ model is vendored into the repository rather than fetched at build.
  Its source repository was archived in 2021; a licence cannot be withdrawn
  from a copy already held, and a build that depends on an archived repository
  staying up is a build that will fail one day.
- Check digits cover the document number and the dates and nothing else. The
  name, nationality and issuing state are excluded from them by the standard,
  so those are never filled in silently — the one field that decides whose
  document this is, is the one field with no way to verify itself.
- `<` and `0` are both worth zero in that arithmetic, so a trailing filler
  misread as a zero validates. A document number ending in zero is flagged for
  confirmation even when its check digit passed.
- Handwriting is out of reach, and tables come back as collapsed lines. Neither
  is a consequence of this choice; no free local option does either.
---

## D28 — The vault quotes and signposts; it does not say what a policy means

**Decision.** Safehouse reads terms-bearing documents three ways and refuses a
fourth. It **classifies** them, because consumer insurance is standardised by
law. It **quotes** the figures off the schedule verbatim, with the insurer's own
label and the page. It **signposts** the conditions by heading, so a household
turns to page 15 instead of reading forty pages.

It will not answer "am I covered for this". Not in a smaller form, not behind
a disclaimer, not with citations attached. No summary of terms, no
interpretation of an exclusion, no statement that a thing is or is not covered.

Two structural rules make the first three safe. Figures are matched only inside
a page range classified as a schedule or a certificate — never the policy
wording, and never the product information document, which is a brochure whose
only numbers are product ceilings and which says so in its own words. And every
match is kept: a label appearing five times produces five quotations with their
pages rather than one chosen answer.

**Why.** The booklet deliberately does not contain the numbers — insurers write
"the maximum we will pay is the buildings sum insured as stated on your
schedule". The conditions and the figures are two different documents bound
into one file, and almost every real failure here comes from reading one as the
other. Classification is cheap and close to certain because the layouts are
legally fixed: a motor certificate carries six numbered headings in order, and
an information document nine headings in wording fixed by regulation since
2018.

The refusal is not about hardware, and a better model next year does not change
it. The evidence, briefly: the published insurance-adjudication benchmark finds
models reaching correct verdicts with incorrect justifications, biased toward
"covered" — right answer, wrong reason, which survives spot-checking and
surfaces at claim time. Household wordings are built from exclusion,
carve-back, re-exclusion chains, which is the structure that collapses first.
Abstention does not improve with model scale. A policy is made entirely of hard
negatives, because "flood" appears in the cover section, the exclusions, the
definitions and an endorsement, lexically near-identical and semantically
opposite. And the best-funded attempts measured — two commercial legal research
products built by the companies that own the corpora — hallucinated on 17% and
33% of queries against marketing that claimed none. That last figure also
closes the cloud as an escape: the cloud is where it was measured.

**The argument that holds regardless of any of that** is this project's own rule.
D26 says a machine proposes and a person confirms. Confirming "expires
2027-03-14" costs one glance. Confirming "flood is excluded unless a pipe
burst" requires reading the forty pages the feature existed to save. So either
the summary was unnecessary, or an unconfirmed machine claim is deciding
something about a household's home — which D26 forbids. A located clause is
confirmable; a summary is not. The refusal falls out of the rules rather than
being imposed on top of them.

**Consequences.**
- No figure is ever read from an information document. Enforced by a page
  allowlist rather than a convention, and the test fails if the allowlist is
  removed.
- Money is quoted and never computed. One real pack carried five premium
  figures whose headline disagreed with the invoice total by a fifty-pound fee.
  Showing an insurer's own labels is a quotation; showing one number is an
  assertion.
- A renewal date is not an expiry date. They usually coincide and are not the
  same fact, so the renewal date is quoted and never proposed as cover ending.
- Policy numbers are never validated or reformatted. There is no checksum and
  no length rule; anchoring on the label is the only reliable thing.
- A policy number is never quoted as a fact, because the identifier is masked
  and a copy in a quotation would hand it back past the password check.
- Roughly one signpost in five is junk. A wrong signpost is a wrong link, which
  costs a moment; a wrong figure would cost more, which is why the two are held
  to different standards.
- If this proves too thin after living with it, the next step is an extractive
  reader returning a highlighted span or the literal words "not stated" —
  never a chat model, never prose, never a paragraph stating coverage.
---

## D29 — Straighten a page for reading, never for keeping

**Decision.** Before a scan is read, the vault derives an upright, straightened,
greyscale copy of it: the orientation tag is honoured, the tilt is measured and
corrected if the measurement was confident, and the borders are trimmed. The
copy lives for the length of one read and is then discarded.

**The stored file is never modified.** The vault keeps the bytes it was handed.
A lossy re-encode of somebody's passport to improve a machine's guess is the
wrong trade, and a cropping mistake on the only copy cannot be undone.

**This amends a consequence of D27.** That decision said accuracy on tilted
pages was poor and "the answer is the upload screen saying so, not a
preprocessing pipeline". The pipeline turned out to be seventy lines and no new
dependency, and what it recovers is larger than anything an engine swap would
buy — one benchmark recovers 81% of an invoice's numeric fields upright and 31%
at three to five degrees. Measured here: a page tilted seven degrees comes back
at 0.23 degrees, in about 120 milliseconds, using a library already installed.
A quality gate at upload is still worth building and is not a substitute.

**Why this method.** A projection profile — shear the page by a candidate angle,
stack the rows, see how cleanly the lines pile up — scored by Leptonica's
differential square sum rather than a plain variance, because the difference
between neighbouring rows rejects background noise that otherwise scales with
how much ink is on the page, and keeps working on two columns. Leptonica is
already in the container as Tesseract's own dependency, and its published
constants are better defaults than anything invented here.

Quarter turns are left to Tesseract, which is asked for page segmentation with
orientation detection and rotates internally. Deliberately not a separate call
that parses an orientation out of stderr: that would buy a threshold to tune
and the ability to turn somebody's page the wrong way round, where the current
arrangement means a wrong call costs a poor text read and never touches a pixel
we keep.

**Consequences.**
- The estimator returns a confidence and is willing to say nothing. Below a
  third of a degree there is nothing to gain; below the confidence floor the
  page did not answer clearly — a blank form, a photograph, one line of text —
  and it is left alone. Rotating on a bad guess makes a document worse, and
  this runs unattended.
- Order inside the pipeline is load-bearing and commented as such. Orientation
  before any crop, because every crop is computed in displayed coordinates.
  Trim last, because a dark scanner edge stops a trim dead if it runs first,
  and because trimming afterwards removes the wedges the rotation added.
- A fixed live bug: sharp does not honour the orientation tag on load, and
  `metadata()` ignores an `autoOrient()` later in the pipeline. The passport
  reader cropped its band using stored dimensions, so a portrait phone photo
  had a vertical strip of margin cropped instead of the machine-readable zone.
  It failed silently — no error, no log, just nothing found.
- An image-only PDF reaches none of this and gets nothing from it. Rasterising
  those is named in D27 and is still not built; for a household whose bills
  arrive as scanned PDFs it is probably worth more than this was.
---

## D30 — An expiry reminder is a question, not a row

**Decision.** "What is running out" is computed by asking the database, every
time somebody looks, against the database's own clock. No scheduled job, no
queue, no stored reminder, and no state that can go stale.

**Why.** A job that fails to run is a reminder that never arrives, and nobody
notices the absence of a thing. That is the worst available failure mode for a
vault of expiring papers: it looks healthy right up to the morning the passport
turns out to have lapsed. A query cannot fail quietly — if it is broken, the
page is broken, and someone sees it. It also costs no second service, which D3
asks for, and it was about forty lines.

**This narrows D13**, which says every notification is written to the database.
That stands for notifications that are *events* — an upload happened, somebody
broke the glass, an access list changed. Those are not derivable and need a row
with a read state and a delivery record. An expiry is derivable from data already
in the vault, so storing it would mean maintaining a copy of a fact the vault
already holds, and then explaining why the copy disagrees. Rows arrive with
outbound delivery, which needs something to mark as sent.

**Consequences.**
- There is no notifications write policy yet, deliberately. It arrives with the
  first notification that cannot be derived, and not before.
- Two refusals decide the list. Only a **confirmed** date counts (D26) — the
  reader proposes dates now, and nagging about a machine's guess teaches a
  household to ignore the warnings, including the true ones. Only the
  **current** version counts (D20) — a superseded passport expired years ago by
  design.
- Already-expired documents are in the list, first. A vault that only warns
  about the future goes quiet exactly when it matters.
- Nothing is dismissible, because there is nothing to dismiss. The way to stop
  a reminder is to file the renewal, which is the behaviour worth encouraging.
  If a household wants to silence one, that needs a stored decision, and that
  is a row — the first honest reason to build one.
- The in-app list shows record titles, because it *is* the vault, behind the
  same policies as every other list. D13's rule that a notification names no
  title governs what leaves the app: an email or a push that says "a document
  expires in nine days, open Safehouse" and nothing more.
- The lead window is read from `settings` inside the same transaction, so a
  request that never said who is asking finds no setting and gets an empty list
  — the same empty answer every other surface gives.

---

## D31 — The server will not start under a key that opens none of the vault

**Decision.** At boot, before it serves anything, the server asks the database
which key-encryption keys the vault's files are wrapped under, and compares
them with the key it was given. If the vault has files and this key opens none
of them, the server does not start, and says which key id it holds and which
ones the vault expects. If the key opens some files but not all, it starts and
logs a warning naming the other key ids. A missing key file stops it too.

**Why.** It happened. The development key file was replaced while a server was
running with the old key in memory. That server kept filing documents under the
old key, the next restart picked up the new one, and the files filed in between
were lost with the old key. Nothing complained until a backup drill tried to
open them. A server under the wrong key looks healthy: the vault lists, search
works, and only opening a file fails. Meanwhile every upload is sealed under the
wrong key, so the longer it runs, the more the vault splits across two keys.
Failing at boot is the only point where the mistake costs nothing.

The question has to be asked before anybody signs in, so no user is set and
every policy matches nothing. That makes it the one question the application
may ask about every row without saying who is asking. It is answered by
`public.vault_key_ids()`, a `security definer` function with no arguments that
returns key ids and nothing else. Key ids are four bytes of a hash of the key,
already written into every wrapped data key. It is in `public` because the
application calls it by name, which `perm` forbids (D25), and EXECUTE is the app
role's alone.

**Consequences.**
- `app/entry.server.tsx` exists now: React Router's default, with one awaited
  call at the top. `react-router-serve` imports it at startup, so a refusal
  stops the process; under Compose, `restart: unless-stopped` turns that into
  a loop whose log says why.
- The server needs the database up to start. Compose already waits for it.
- It does not detect a key file replaced *while* the server runs, because the
  key is read once and cached. Restarting is what reads it again, and that is
  when this check runs.

---

## D32 — An invite is a password reset for an account with no password

**Decision.** There is one kind of link. The admin makes it from the roster,
copies it, and gives it to the person by hand (D13). For somebody with no
sign-in, the admin first types their email, and Safehouse creates an
`individual` account attached to that person, with no password. For somebody
who already has a sign-in, the same button makes a reset link. Either way the
link sets a password once, lasts 72 hours, and signs the account out
everywhere else.

**Why.** The auth library already has a single-use, expiring, hashed-on-use
token flow: password reset. Its `resetPassword` creates the password
credential when the account has none, so an invite needs no second mechanism.
Building a separate invite token would have meant hand-rolling exactly what
CLAUDE.md says not to.

The library serves the reset request publicly and hands the token to a
`sendResetPassword` callback. Here that endpoint answers only to an active
admin, like sign-up, and the callback delivers only to the `signInLinkFor`
call that asked, through an AsyncLocalStorage slot. A request that arrives any
other way has nowhere to deliver and fails. When email exists, it is a second
thing that callback does with the same token.

**Consequences.**
- The token travels in the URL fragment (`/set-password#…`). The browser never
  sends a fragment, so the token stays out of the server's request log and out
  of Referer headers. The page therefore needs JavaScript to read it.
- An invite always makes an `individual`. Admin is made once, at first run. A
  third party or an emergency contact has no person to attach to, so no link
  can be made for them from the roster yet; that belongs to the access console.
- Every link made is logged (`account.invited`, `account.link-made`) in the
  admin's vault transaction, and the link is shown only after that write. The
  link itself is never stored or logged.
- The password floor is 12 characters for everybody, enforced by the library,
  where it had been enforced only on the setup page.
- Checking `disabledAt` moved into the auth module's gates. Before this, a
  disabled admin with a live session could still create accounts through the
  sign-up endpoint.

---

## D33 — The tree shows sex where recorded, and relationships that ended

**Decision.** The family tree shows each person's name, a mark for somebody
who has died, and female or male where it has been recorded. `people.sex` is
nullable, and existing people stay null ("not recorded"). Relationships that
have ended (a divorce, a guardianship that ran out) are drawn as dashed grey
lines and labelled, not hidden. Businesses and the household are separate
tabs beside the family.

**Why.** The household asked for all three. Sex is nullable because a vault
that has been running without it has no true value to fill in, and a default
would assert something nobody said. Ended relationships are shown because the
tree is the household's record of itself as well as a navigation device, and a
family with a divorce in it looks wrong without one. They are drawn
differently because the access model ignores them (`current_spouse` and
`effective_parent` both require `ended_on is null`), and the picture should
not imply otherwise.

**Consequences.**
- The tree draws only lines whose two ends the viewer can see, because
  `relationships_read` already requires that. An ended edge is no exception:
  Maya does not see Daniel's divorce, because she cannot see Nadia.
- `sex` has two values. A household that needs another can add an enum value
  in a migration; nothing reads it except the tree.
- The tree's payload is a name, a deceased flag and sex per person. Given name,
  family name and date of birth stay out, as on the roster.

---

## D34 — "N of M" is out of what the admin can see, and only an admin sees it

**Decision.** Closes view-as open question 5. Everywhere a reach is shown,
the denominator stays the admin's own reach, counted in the admin's own
transaction. The wording now says so: "Sam reaches 9 of the 36 documents you
can see", never "of 36". The total goes to administrators only. The access
console (`/access`) refuses anybody else outright, and the vault banner renders
only behind the view-as gate, which only an admin passes.

Grants are edited in the console and nowhere else (D21). They are written by
the admin only: `0012_grant_writes.sql` allows insert and delete on the three
grant tables under policies that name `current_user_is_admin()`, and asserts
that text. Every change is one log line in the same transaction: the account
as subject, and what changed in `target_id` / `target_category`. Those columns
are typed, so the log cannot hold free text.

**Why.** The household raised it: a count of the whole vault tells whoever
reads it that more exists than they can see. Counting as the admin and showing
it only to the admin means the number never says more than its reader could
already find out. The wording is there for the day an admin can be narrowed:
"of the 36 you can see" stays true then; "of 36" would quietly become a lie.

**Consequences.**
- Nobody but an admin is ever sent a document count other than their own.
  `app/db/access.test.ts` checks that the console refuses a member. Nothing
  else computes a total.
- The console reads reach the way view-as does: one read-only transaction per
  account, behind `gateViewAs`. Its matrix is tested against `matrix.txt`, so
  the console cannot disagree with the policies (D21).
- Which grant lists the panel offers depends on role: owners and records for a
  member; owners, categories and records for a third party; none for an admin
  or an emergency contact. That is presentation only, and the policies do not
  care.
- Not here: changing a role, disabling an account, opening or revoking an
  emergency window. Each is its own escalation path and gets its own policy
  when it is built.

---

## Open decisions

None. D9–D21 closed the list that stood here; D22 to D34 record what building
the schema, the sign-in path, the permission layer, reading a scan and saying
what expires forced into the open.

Worth revisiting deliberately rather than by drift:

- **Emailing anybody** (D8) — with no mail, a forgotten password is an admin
  job. Revisit when that becomes a nuisance rather than a rarity.
- **Key custody** (D12) — passphrase-unlock is designed for and not built. Decide
  again once real documents are in and the operational rhythm is known.
- **Readable identifiers** (D14) — an accepted risk with a documented alternative,
  not a closed question.
- **Per-owner category grants** (D18) — revisit if the per-record exception stops
  being exceptional.
- **Reading a document somewhere else** (D26) — allowed only per document,
  with its own spec, and not built. Revisit when the local reader has been
  lived with long enough to know what it actually fails on.
