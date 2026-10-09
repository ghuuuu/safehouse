# Safehouse

A private, self-hosted household document vault. Passports, wills, medical
records, deeds, and business permits — filed by who they belong to, browsable
through the family tree, with access derived from real relationships.

One household per deployment. Your documents stay on your server.

---

## Status

Built for one household. Filing, the vault, search, the family tree,
the access console, two-factor sign-in, break-glass, and backups that are
proven to restore. First run for a household that is not this one (an empty
database, no tree) is not built yet.

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — what it is and how it behaves
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decisions and reasoning
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — running it: backups, upgrades, restoring, the key
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what was built, in what order, and what is left
- [`CLAUDE.md`](CLAUDE.md) — working agreement for AI-assisted development

## Before writing any code

Read `docs/DECISIONS.md`. In particular D1: **permissions resolve on the server,
always.** Most of the architecture follows from that one rule.

## Getting started

Requires Docker and Node 24 or newer.

```sh
cp .env.example .env          # local settings; never commit .env
npm run key:make              # once; write the printed key down elsewhere
mkdir -p storage              # on Linux: sudo chown 1000:1000 storage
docker compose up -d db       # database first
npm install && npm run db:migrate
docker compose up --build     # app + database
```

Then open <http://localhost:4020>; the first visit offers to create the
administrator. Stop it with `docker compose down`. Before anything real goes
in, read [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

### Working on it

On Windows, double-click `start.bat`. It checks for Node and Docker (offering
to install them with winget), copies `.env` on a first run, installs
dependencies, starts and migrates the database, makes the encryption key if
there is none, offers the fictional sample household when the vault is empty,
then runs the dev server and opens <http://localhost:4021>. By hand:

```sh
docker compose up -d db       # database only
npm install
npm run db:migrate            # after any schema change
npm run dev                   # http://localhost:4021
```

`npm test`, `npm run lint` and `npm run typecheck` must all pass before a
commit. The full command list is in [`CLAUDE.md`](CLAUDE.md).

## Security

This application is designed to hold identity and legal documents. If you are
contributing or self-hosting:

- Never commit `.env` files, encryption keys, or document files. See `.gitignore`.
- Never use real personal data in development or test fixtures.
- Do not put real documents in until backups are configured and a restore has
  been tested.
