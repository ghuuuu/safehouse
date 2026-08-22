# Safehouse

A private, self-hosted household document vault. Passports, wills, medical
records, deeds, and business permits — filed by who they belong to, browsable
through the family tree, with access derived from real relationships.

One household per deployment. Your documents stay on your server.

---

## Status

Pre-development. Documentation and architecture only — no application code yet.

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
docker compose up --build     # app + database
```

Then open <http://localhost:3000>. The page reports whether the database is
reachable. Stop it with `docker compose down`.

### Working on it

```sh
docker compose up -d db       # database only
npm install
npm run dev                   # http://localhost:5173
```

`npm test`, `npm run lint` and `npm run typecheck` must all pass before a
commit. The full command list is in [`CLAUDE.md`](CLAUDE.md).

### What exists so far

The scaffold only: a page that proves the app can reach Postgres. No accounts,
no documents, no vault. Database tables arrive with the permission tests that
guard them.

## Security

This application is designed to hold identity and legal documents. If you are
contributing or self-hosting:

- Never commit `.env` files, encryption keys, or document files. See `.gitignore`.
- Never use real personal data in development or test fixtures.
- Do not put real documents in until backups are configured and a restore has
  been tested.
