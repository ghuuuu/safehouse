# Safehouse

A private household document vault. Passports, wills, medical records, deeds,
business permits — filed by **who they belong to**, not which folder someone
dropped them in. Self-hosted, one household per deployment.

Full product spec: `docs/PRODUCT.md`
Architecture decisions and their reasoning: `docs/DECISIONS.md`
Read both before proposing structural changes.

---

## The one rule

**The server never sends a document the requester isn't entitled to see.**

Permission filtering in the client is presentation, not security. Every list,
search result, and file download resolves permissions server-side, before the
response is built. If you find yourself filtering an array in a React component
for access-control reasons, that's the bug.

This applies to masked fields too: if a passport number is masked in the UI,
the unmasked value must not be in the API response.

---

## Stack

_To be confirmed in the architecture planning session — do not assume._

- Runtime: TBD
- Database: Postgres
- File storage: local disk, encrypted at rest
- Deployment: Docker Compose, self-hosted

## Commands

_To be filled in once the project is scaffolded._

```
# dev:
# build:
# test:
# lint:
```

---

## Boundaries

- `reference/prototype/` — **read-only.** This is the old in-memory prototype,
  kept for behaviour and data-shape reference only. Do not copy its structure,
  its state management, or its client-side permission filtering. It was a
  session-only mockup; this project is not.
- Never write real personal data into seed files, tests, or fixtures. All seed
  data is fictional. No real passport numbers, ever — not even your own.
- Never log document contents, file names, or record field values.
- Don't add dependencies without saying why first.

## Conventions

- Prefer boring, well-maintained libraries over clever ones. This is a vault;
  it should be dull.
- Do not hand-roll authentication, session handling, or cryptography.
- Every new surface that lists documents must be checked against the permission
  predicate. When adding one, say explicitly how it enforces access.
- Write the test for a permission rule before the rule.

## Working style

- Propose a plan before multi-file changes.
- Small commits. One concern each.
- If a request would weaken the one rule above, say so instead of doing it.
