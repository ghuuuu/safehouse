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

_To be written once the stack is chosen._

## Security

This application is designed to hold identity and legal documents. If you are
contributing or self-hosting:

- Never commit `.env` files, encryption keys, or document files. See `.gitignore`.
- Never use real personal data in development or test fixtures.
- Do not put real documents in until backups are configured and a restore has
  been tested.
