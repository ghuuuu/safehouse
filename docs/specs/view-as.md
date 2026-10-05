# Spec: View-as mode

Status: **implemented, uncommitted** — tests, typecheck and lint green;
authenticated browser pass not yet done (see Verification below)
Relates to: PRODUCT.md "Resolution"; DECISIONS.md D1, D11, D21, D22, D25

## Objective

Let an admin re-render the entire vault as any other user experiences it, and
show how much of the vault that person can reach.

**Why this, and why now.** Five commits have built a permission layer that no
HTTP request has ever touched. `withVault` is imported by nothing. Four
`security definer` functions in `drizzle/0004_permission_functions.sql` answer
only to tests. View-as is the cheapest artifact that proves the layer works,
because it is the permission model with one argument changed rather than a
feature built on top of it — the database's whole notion of who is asking is
one transaction-scoped string (`app/db.server.ts:56`).

It is also, per PRODUCT.md, the thing that turns an abstract permission matrix
into something a person can check by looking.

**User.** The household admin — for now, the person who deployed this and is
about to put their family's real passports in it. The question they need
answered is not "what is Maya's role" but "what would Maya actually see."

**Success.** Signed in as admin, pick the bookkeeper, and the vault renders the
LLC's Financial and Business documents and nothing personal — with a banner
naming whose eyes these are and a count of what they reach.

## Scope

In:

- A vault list: every document the current database user may see, grouped by
  category. Unstyled beyond legibility.
- A user picker listing candidates for impersonation.
- Impersonated rendering of that list, server-side.
- A persistent banner: whose view this is, how to leave, and "N of M documents".
- An exit path back to the admin's own view.

Out, and why:

- **Activity logging of activations.** No write policy exists on any table
  (`0001_permission_layer.sql:22`). Adding one is a separate capability with
  its own security surface. Tracked as a successor; PRODUCT.md requires it
  before this is a finished product.
- **Denial reasons** ("Maya cannot see 22 of 36, and here is why each"). The
  highest-value successor — the reason column is where a wrong rule announces
  itself — but it needs `perm` to *explain* rather than filter, which is new
  SQL, not new UI.
- **Visual design.** `docs/DESIGN.md` does not exist. This spec does not invent
  it. Semantic HTML, minimal CSS, replaceable.
- **The family tree, search, upload, records, masking.** None are prerequisites.
- **Writes of any kind while impersonating.** See Boundaries.

## Design

### The impersonation primitive

`withVault` currently hardcodes the session user (`app/session.server.ts:84`).
It grows a sibling rather than a flag, so that impersonation is impossible to
reach by accident:

```ts
// The acting user and the viewed user, which are usually the same person.
export async function withVaultAs<T>(
  request: Request,
  work: (db: VaultTransaction, ctx: ViewContext) => Promise<T>,
): Promise<T>;

export type ViewContext = {
  actor: SignedInUser;   // who is really signed in
  viewedUserId: string;  // whose eyes the database is using
  isViewingAs: boolean;  // viewedUserId !== actor.id
};
```

### The gate, and why it cannot live inside the transaction

`perm.current_user_is_admin()` reads `public.current_app_user()`, which is the
setting impersonation changes. Inside an impersonated transaction the database
correctly believes you are the viewed user — so it cannot be asked whether you
were allowed to become them.

Therefore authorization runs **before** the switch, in the actor's own context:

1. Read the actor from the session cookie (`requireUser`).
2. If a viewed user is requested and `actor.role !== "admin"` → 403. Not a
   redirect, not an empty list: a refusal.
3. Only then open the vault transaction as the viewed user.

Step 2 reads `actor.role`, which comes from the auth connection
(`safehouse_auth`, D24) and not from the impersonated context. That separation
is the entire security surface of this feature and the tests target it
directly.

### The two counts

"14 of 36" is two numbers from two different user contexts: 14 as the viewed
user, 36 as the admin. They cannot come from one transaction, because the
transaction has exactly one user set. Two sequential transactions, actor first.
The admin's total is computed as the admin — not as a raw unfiltered count,
which would leak the existence of documents the admin cannot see.

### Where the viewed user lives

A URL search param on the vault route: `/vault?as=<userId>`. Not a cookie, not
server session state. Consequences, all wanted: a refresh does not silently
keep you in someone else's eyes, two tabs can hold two different views, and the
state is visible in the address bar rather than invisible and sticky.

## Tech stack

No new dependencies. React Router v7 framework mode, Drizzle for the ordinary
reads, raw SQL if a query expresses a permission rule (CLAUDE.md).

## Commands

Per CLAUDE.md; not restated here. Relevant to this work:

```
npm run dev        # http://localhost:4021, needs: docker compose up -d db
npm test           # builds safehouse_test from migrations + app/db/fixture.ts
npm run typecheck
npm run lint
```

## Project structure

```
app/session.server.ts         withVaultAs, ViewContext  (modified)
app/routes/vault.tsx          the list + banner         (new)
app/routes.ts                 route registration        (modified)
app/view-as.server.ts         the gate, in one place    (new)
app/view-as.server.test.ts    the gate's tests          (new)
docs/specs/view-as.md         this file
```

The gate gets its own module rather than living in the route, so that its tests
name it directly and a second impersonating surface cannot re-implement it
slightly differently.

## Code style

Match the surrounding code. Existing modules carry a header comment explaining
*why* the module exists, not what it does — `app/session.server.ts:5-13` is the
model. Comments explain reasoning and consequences; they do not narrate.

## Testing strategy

Vitest, against `safehouse_test` built from the migrations and
`app/db/fixture.ts` on every run. Per CLAUDE.md: **the test for a permission
rule is written before the rule.**

Three levels:

1. **The gate** (`app/view-as.server.test.ts`) — a non-admin requesting `?as=`
   is refused; an admin is not; a malformed or unknown user id is refused
   rather than falling through to the actor's own view.
2. **The predicate under impersonation** (extends `app/db/permissions.test.ts`)
   — for each of the six fixture users, the document set returned under
   impersonation is *identical* to the set that user gets signing in normally.
   This is the assertion that makes view-as trustworthy: a view-as that shows
   something other than the truth is worse than no view-as.
3. **A full matrix snapshot** — six users by thirty-six documents, rendered as
   a text table and committed. Every future permission change shows up as a
   reviewable diff in one file. This is variation #3 from the ideation session,
   kept as a test asset rather than shipped as a screen.

## Boundaries

**Always**

- Resolve permissions server-side, before the response is built (CLAUDE.md).
- Reach the vault only through `withVault` / `withVaultAs`.
- Write the permission test before the rule.

**Ask first**

- Any new `perm` view or `security definer` function.
- Any write policy (this spec assumes none are added).
- Any dependency.

**Never**

- Give a `perm` function a user-id parameter (D25). Impersonation changes the
  session setting; it does not parameterize the rules.
- Grant the app role USAGE on `perm`.
- Filter documents in a React component for access-control reasons.
- Perform a write while `isViewingAs` is true.
- Put real personal data in the fixture.

## Success criteria

- [ ] `GET /vault` as a signed-in user lists exactly the documents
      `perm.visible_document_ids()` returns for them, grouped by category.
- [ ] `GET /vault?as=<id>` as an admin renders the vault as that user.
- [ ] `GET /vault?as=<id>` as a non-admin returns 403 — not an empty list, not
      a redirect.
- [ ] `GET /vault?as=<unknown-or-malformed-id>` is refused, and does not fall
      through to the actor's own view.
- [ ] The banner names the viewed user, shows "N of M", and offers an exit.
- [ ] For all six fixture users, impersonated document sets equal signed-in
      document sets.
- [ ] The committed matrix snapshot matches the fixture.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` pass.

## Verification, as run

Green:

- `npm test` — 137 passing, 21 of them new (`app/view-as.server.test.ts`,
  `app/db/view-as.test.ts`). `npm run typecheck`, `npm run lint`, `npm run
  build` all clean.
- `GET /vault` and `GET /vault?as=<id>` signed out both redirect to `/sign-in`
  with `next` preserved, so signing in lands back in the borrowed view.

Not yet verified, and not claimed:

- **The authenticated path in a browser.** The banner, the picker, the "N of M"
  counts and the 403 for a non-admin have unit and database coverage but have
  never been rendered. The dev database has no accounts; proving this end to
  end needs a household seeded through `/setup`.
- The matrix snapshot from the testing strategy is **not** built. The parity
  assertions cover the same ground per-user; the committed diffable table does
  not exist yet.

## Open questions

1. ~~**Can the app role list users at all?**~~ **Resolved.** `users_read`
   (`0004_permission_functions.sql:213`) is
   `id = current_app_user() or perm.current_user_is_admin()`, so an admin lists
   the full roster as `safehouse_app`. No new `perm` view needed.

   Consequence for implementation: load the picker in the **actor's**
   transaction. Inside impersonation `perm.current_user_is_admin()` is false
   and the roster collapses to the viewed user alone. It fails closed, but it
   fails confusingly, so it gets a test.
2. ~~**Is `role` on the session trustworthy for the gate?**~~ **Resolved.** Yes,
   as the auth library is configured. `getSignedInUser` calls better-auth's
   `getSession`, which reads the session row and joins the user on every
   request; no `session.cookieCache` is configured, so no copy of the role
   exists anywhere to go stale. An admin demoted in the database is refused on
   the very next request — same cookie, same session row, 403 — asserted in
   `auth.server.test.ts` ("an admin demoted mid-session can no longer borrow
   anybody's eyes"). The gate needed no change.

   That test is also the guard on the configuration, because the answer is a
   configuration and not a law. Enabling `session.cookieCache` would let the
   gate decide from a cached role for as long as the cache lives; with it
   enabled the test fails, which was checked by enabling it rather than
   assumed. The sign-in helper forwards every cookie the server set for the
   same reason: forwarding only the session token made the test pass for the
   wrong reason first time round.
3. **Does an admin viewing as themselves count as view-as?** Proposed: no
   banner, `isViewingAs` false, treated as the ordinary path.
4. **Should a per-record grant carry the owner's name?** Found while building,
   not before. Sam is granted Rose's will by name (D17), so he sees the will —
   but `ownersVisibleTo(sam)` is `["hale"]` alone, asserted deliberately in
   `permissions.test.ts`. An inner join to `owners` dropped the will off his
   list entirely; it is now a LEFT join and the page says "owner not shown to
   you".

   That is faithful to the rules as written. Whether the rules are right is a
   product question: an estate attorney handed one will who cannot see whose
   estate it is may be correct privacy or may be useless. Deciding it means
   changing `perm.visible_owner`, which is an "ask first" boundary. **Not
   changed. Raised.**
5. **Is 36 the right denominator?** "N of M" where M is the admin's reach reads
   as "of everything". If an admin ever cannot see everything, the phrasing
   needs to change. Today admins see all; D1 does not promise they always will.
