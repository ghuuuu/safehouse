# Safehouse

A private, self-hosted household document vault. Passports, wills, medical
records, deeds, and business permits — filed by who they belong to, browsable
through the family tree, with access derived from real relationships.

One household per deployment. Your documents stay on your server.

---

## Status

Early development. The database and sign-in are built; there is no way to put
a document in yet.

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — what it is and how it behaves
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decisions and reasoning
- [`CLAUDE.md`](CLAUDE.md) — working agreement for AI-assisted development

## Before writing any code

Read `docs/DECISIONS.md`. In particular D1: **permissions resolve on the server,
always.** Most of the architecture follows from that one rule.

## Getting started

Requires Docker and Node 24 or newer.

```sh
cp .env.example .env          # local settings; never commit .env
docker compose up -d db       # database first
npm install && npm run db:migrate
docker compose up --build     # app + database
```

Then open <http://localhost:4020>. The page reports whether the database is
reachable. Stop it with `docker compose down`.

### Working on it

```sh
docker compose up -d db       # database only
npm install
npm run db:migrate            # after any schema change
npm run dev                   # http://localhost:4021
```

`npm test`, `npm run lint` and `npm run typecheck` must all pass before a
commit. The full command list is in [`CLAUDE.md`](CLAUDE.md).

### What exists so far

The schema, the permission rules, and signing in.

Every table exists, and so does the layer that decides who may read each row:
family circle, private records, third-party grants, and time-limited emergency
access are all enforced inside Postgres by row-level security, not by
application code. The rules themselves sit in a schema the application cannot
read, so a bug in it cannot ask who is entitled to what (D25).
`app/db/permissions.test.ts` states those rules in English and checks them
against a real database as the real restricted role.

Sign-in works. The first time you open the app it offers to create the
administrator; after that, accounts are made by the administrator and the public
sign-up endpoint is closed. Signing in and reading documents use two different
database roles, so the half of the application that checks passwords cannot read
a single record (`docs/DECISIONS.md` D24).

There is still no upload and no vault interface. The page you land on after
signing in shows how much of the vault you are entitled to see, which is nothing
at all until somebody adds a person and a record.

## Security

This application is designed to hold identity and legal documents. If you are
contributing or self-hosting:

- Never commit `.env` files, encryption keys, or document files. See `.gitignore`.
- Never use real personal data in development or test fixtures.
- Do not put real documents in until backups are configured and a restore has
  been tested.
