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
commit, or a bug report. The eleven-person fictional household from the
prototype is sufficient and should be reused.

---

## D8 — The prototype is reference, not foundation

**Decided.**

`reference/prototype/` is read-only. Its behaviour and data shape are useful;
its architecture is not to be carried forward.

**Why.** It was a session-only, in-memory mockup with client-side permission
filtering — precisely the things D1 forbids. Left in the repo without this note,
it becomes the strongest structural signal available and gets copied.

---

## Open decisions

Not yet made. Each deserves a planning session before code.

- **Runtime and framework.** Constraints: self-hostable in Docker, a solo
  maintainer who isn't a full-time engineer, good file-upload and
  server-side-rendering story.
- **Auth solution** (see D4).
- **Key management for at-rest encryption** (see D5).
- **Schema shape** for owners, records, documents, versions, and grants —
  specifically how tree relationships are stored such that the derived
  "immediate family" circle is queryable rather than computed in application
  code on every request.
- **Access console direction** — see `PRODUCT.md` open questions.
- **Emergency window** — fixed 24h or configurable.
