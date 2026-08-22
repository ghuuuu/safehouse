# Safehouse — Product Specification

## The problem

A family's critical paperwork — passports, birth certificates, immunization
records, wills, insurance policies, business permits — lives scattered across
drawers, email attachments, and phone photos. Nobody but one person knows where
anything is, and that person is a single point of failure.

Safehouse makes a household's paperwork one browsable, searchable, permissioned
surface, organized around **who a document belongs to** rather than which folder
someone happened to drop it in.

## Who it's for

Primary user: a single extended household, self-hosted by one of its members.

The same codebase can be deployed empty for another family. Each family gets
their own instance and their own database — see `DECISIONS.md` for why this is
deliberately not a multi-tenant application.

## Design intent

The target feeling is a well-kept home filing cabinet: calm, tactile, private.
Explicitly not a cloud storage product and not enterprise SaaS.

_The visual direction is being re-explored. See `docs/DESIGN.md` once it exists._

---

## Core model

**Documents belong to owners, and owners sit on a family tree.**

### Owners

Every document is filed to an owner. An owner is one of three kinds:

- **A person** — Maya, Daniel, Iris, Theo, Ruth
- **A business entity** — Hale Consulting LLC
- **The household itself** (`fam`) — marriage certificate, property deed, home
  insurance policy

People are arranged in an interactive family tree, which is the app's primary
navigation device. Pan and zoom it, click a person, and the entire vault below
filters to that person.

Sibling and spouse relationships are **real data, not decoration** — the access
model reads them directly to derive who can see what.

A mode switcher at the top of the dashboard toggles the whole app between
**Individuals** and **Businesses**. A business's paperwork (registrations,
permits, contracts) is a genuinely different filing problem from a person's
identity documents, and mixing them made both worse.

### Documents vs. records

- A **document** is a scanned file with a date.
- A **record** is the structured entity behind it. A passport record has a
  passport number, country, issue and expiry dates, place of issue, plus
  free-text notes about where the physical original is stored.

Sensitive fields (passport numbers, license numbers) are masked until
explicitly revealed.

### Versioning

Records carry version history. Documents sharing a **series key** collapse into
one card in the vault showing only the current version, with superseded versions
("Passport 2014–2024", tagged expired) stacked behind it.

Renewing a passport doesn't create clutter — it supersedes.

### Taxonomy

Six categories, each with its own color and subcategories:

| Category | Subcategories |
|---|---|
| **Personal** | passports, national ID, licenses, birth/marriage certificates |
| **Medical** | labs, imaging, immunizations, prescriptions, insurance cards, visit summaries |
| **Business** | permits, registrations, contracts |
| **Financial** | bank statements, insurance policies, tax returns |
| **Legal** | wills, deeds, power of attorney |
| **General** | warranties, school, receipts |

Personal, Medical and Business are deliberately top-level rather than buried,
because they are what people actually reach for in a hurry.

---

## Access control

The most consequential part of the system. Four roles:

### Admin
Full access to every member, business, and document. The only role that can
grant access. The first person to sign in becomes the household admin and seeds
the tree.

### Individual
Sees their own records plus their immediate family — **derived from the tree
rather than configured by hand**: spouse, children, parents, and spouse's
parents. An in-law sees their spouse's household but not their sibling-in-law's
separate one.

### Third-party
An outside professional (estate attorney, bookkeeper). Sees only what's
explicitly granted, along two independent axes: **which owners** (people and
businesses) and **which categories**.

The attorney gets family Legal documents. The bookkeeper gets the LLC's
Financial and Business documents and nothing personal.

### Emergency
A break-glass contact. Sees nothing until activated. On activation, gets a
time-limited window into critical categories only (medical, wills, POA), and
the admin is alerted.

### Resolution

Permission resolution is a **single predicate** — *can this user see this
document* — evaluated against owner and category. Every list in the app filters
through it.

Its most useful expression is **view-as mode**: an admin picks any user and the
entire app re-renders as that person experiences it, with a persistent banner
naming whose eyes you're borrowing and how much of the vault they can reach
("14 of 36 documents"). It turns an abstract permission matrix into something
you can check by looking.

An **activity log** records views, downloads, uploads, grants, and role changes.

---

## Screens

Six views share one sidebar:

- **Dashboard** — family tree, expiring-soon list, category overview, quick-search chips
- **Vault** — the filtered document grid or list, grouped by category, with tag and subcategory filters
- **Record** — document viewer with page navigation and fullscreen, alongside the structured field panel and version list
- **Search** — global search across document titles, categories, tags, and record field values (you can find a passport by its number)
- **Bulk** — a triage surface for sorting a large intake of files across people and categories at once
- **Settings** — Account (household roster, first-run setup), Security (2FA, biometric, PIN, auto-lock interval, active devices), Notifications (expiry reminders with configurable lead time, upload alerts, access alerts, weekly digest)

Three modal flows sit on top:

- **Upload** — drop files, assign owner and category per file, or apply one assignment to all
- **Add member wizard** — built around one sentence: *"___ is the ___ of ___."* Name the person, pick the relationship, pick the anchor they attach to; the tree redraws. The exception is the root: the first person in a household has nobody to attach to, so step 2 shows a "You're the root of the tree" card instead of a relationship picker.
- **Add business**

### Access console

Currently exists in two directions. **Both ship in the prototype; one should be
chosen.** See open questions below.

- **Matrix** — users as rows, owners and categories as columns, one cell per intersection
- **Per-user detail panel** — pick a person, see their role, derived family circle, grant toggles, and document reach as a filled bar

---

## Open product questions

1. **Which Access console direction to keep.** Recommendation: per-user panel as
   the default (it's for *doing*), matrix as a secondary audit view (it's for
   *checking*). Cheap to reverse either way.
2. **Emergency window duration** — fixed 24 hours, or admin-configurable?

---

## Prototype status (superseded)

The original prototype implemented all of the above interactively, driven by
in-memory seed data: one household of eleven people, one business, ~36 documents
including superseded versions, six app users across the four roles, and an
activity feed.

Grant toggles, break-glass activation, role changes, and view-as were live but
**session-only** — nothing persisted, and there was no backend, auth, file
storage, or invite delivery.

That prototype is kept in `reference/prototype/` for behaviour reference only.
This project is a rebuild, not a continuation.
