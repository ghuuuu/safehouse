# Safehouse

A private household document vault. Passports, wills, medical records, deeds,
business permits — filed by **who they belong to**, not which folder someone
dropped them in. Self-hosted, one household per deployment.

Full product spec: `docs/PRODUCT.md`
Architecture decisions and their reasoning: `docs/DECISIONS.md`
Read both before proposing structural changes.
What is left to build and in what order: `docs/ROADMAP.md`

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

Settled in `docs/DECISIONS.md` D9–D12. The reasoning lives there — read it
before proposing a change, don't re-derive it.

- Runtime: TypeScript throughout, React Router v7 in framework mode, one Node
  container
- Database: Postgres. Permission rules are SQL views with row-level security
  underneath them (D11), not application code. The views live in the `perm`
  schema, which the app role cannot reach; policies call `security definer`
  functions over them (D25)
- Data access: Drizzle for schema and migrations; raw SQL for anything that
  expresses a permission rule. The app connects as `safehouse_app`, a role that
  cannot bypass row-level security (D22); the owner role is for migrations only
- Auth: maintained auth library inside the app, sessions in Postgres, no
  identity server (D10). It connects as `safehouse_auth`, a third role that can
  read a password hash and cannot read a single document (D24). Sign-up is not
  public: first run, or an admin
- File storage: local disk, envelope-encrypted per file, key read from a mounted
  key file at boot (D12)
- Deployment: Docker Compose, self-hosted

No Redis, no worker, no second service unless something genuinely cannot work
without it.

## Commands

```
# dev:        npm run dev         → http://localhost:4021
#             needs the database:  docker compose up -d db
#             start.bat does all of it on Windows: tools, .env, install,
#             database, migrate, key, sample household if empty, browser
# build:      npm run build
# test:       npm test            (npm run test:watch while working)
# lint:       npm run lint
# typecheck:  npm run typecheck
# whole app:  docker compose up --build  → http://localhost:4020
# migrations: npm run db:generate  writes a migration from app/db/schema.ts
#             npm run db:migrate   creates the app role, applies migrations,
#                                  then seals any readable identifier (D35)
#             npm run identifiers:seal  that last part on its own; run it
#                                  after restoring a backup from before D35
#             npm run db:setup     the app role on its own (db:migrate runs it)
# dev data:   npm run db:seed      the fixture household, and a way back in
#             npm run dev:logins   one sign-in per role on an already-seeded vault
# the key:    npm run key:make     once per deployment, before the first upload
# backup:     npm run backup       database encrypted, documents copied as-is
#             npm run backup:drill prove one restores, into a throwaway database
#             npm run restore      put one back (refuses a vault with accounts)
# upgrade:    npm run upgrade      backup, drill, then migrate; stops at the first failure
```

Running a real vault — schedules, upgrades, restoring, the key — is
`docs/OPERATIONS.md`.

First run, and after any schema change: `docker compose up -d db` then
`npm run db:migrate`. The app container has no owner credentials and cannot
migrate itself, on purpose (D22).

`npm run db:seed` fills an empty dev database with the fictional fixture
household and gives one account per role the dev password printed by the
script (the list is `app/dev-logins.server.ts`). Both halves matter: seeding
closes `/setup`, so a seeded database without a credential row has no way in
at all. It refuses a database that is not on this machine, and one that
already has accounts. `npm run dev:logins` writes just those sign-ins, for a
vault seeded before the list grew.

In `npm run dev` against a database on this machine, the sign-in page shows a
button per role that signs in as that account. The button sends only which
account; the server adds the password and signs in through better-auth as
usual. Every use sits behind `import.meta.env.DEV`, so a production build
contains none of it: after touching it, build and grep `build/` for
`example.invalid`, which must find nothing. (The dev password is `password`,
too common a word to grep for; the dev accounts' addresses are the marker.)

`npm test` needs the database running. It builds `safehouse_test` from the
migrations and the fixture in `app/db/fixture.ts` on every run.

A backup is the database encrypted under the key-encryption key plus the
document store copied verbatim — the blobs are already sealed, so they are not
encrypted twice. The key file is in neither, and the finished backup is
searched for it before the command exits. Losing the key loses the backups too
(D12); that is the trade, and the alternative is a backup that opens without a
key, which is no backup at all.

Run `npm run backup:drill` after any change to the schema or the storage
layout. D6 asks for restore to be tested rather than assumed, and the drill
restores into a throwaway database and opens a real document out of it. With no
argument it drills the newest backup in `./backups`, and a pass is recorded in
the vault so the admin's dashboard can notice when drills stop (D38). A grant
added by a migration must survive a restore: the drill checks that it does.

`npm run dev` prints future-flag warnings about React Router v8 and one Vite
deprecation notice. Those are expected — see D9. Anything else in that output is
worth reading.

---

## Boundaries

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
- A new permission view goes in `perm` and gets a zero-argument `security
  definer` function for the policies to call (D25). Never grant the app role
  USAGE on `perm`, and never give one of those functions a user-id parameter.
- Read the vault through `withVault` in `app/session.server.ts`. It is the only
  thing that turns a cookie into a named transaction; a query made any other way
  has no user set and comes back empty.
- Write the test for a permission rule before the rule.

## Working style

- Propose a plan before multi-file changes.
- Small commits. One concern each.
- If a request would weaken the one rule above, say so instead of doing it.
- When asking the owner to decide something, recommend an answer for each
  question.

## Versioning

SemVer in `package.json`, and an annotated `vX.Y.Z` tag on the commit. Every
commit bumps it, in that same commit:

- **patch:** fixes only; nothing new to see, nothing to do when deploying
- **minor:** anything new, or anything that needs a step when deploying (a
  migration, a new env var, an image rebuild)
- **major:** held for 1.0, the first install in another household

```
npm version <patch|minor> --no-git-tag-version   # package.json and the lock
git commit ...
git tag -a vX.Y.Z -m "<one line: what changed>"
git push --follow-tags                           # only when asked to push
```

The build bakes the version in (`vite.config.ts`). Settings shows it and the
server prints it at boot, so `docker compose logs app` says what the mini PC is
running.
