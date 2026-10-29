<p align="center">
  <img src="public/logo/SH-logo.svg" alt="SafeHouse Logo" width="80" height="86" />
</p>

<h1 align="center">SafeHouse</h1>

<p align="center">
  <strong>A private, self-hosted household document vault.</strong><br />
  Passports, wills, medical records, deeds, and business permits — filed by who they belong to,<br />
  navigable through the family tree, protected by PostgreSQL Row-Level Security, and encrypted at rest.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.2-amber" alt="Version 0.1.2" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0 License" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-brightgreen" alt="Node >= 24" />
  <img src="https://img.shields.io/badge/database-PostgreSQL%2018-blue" alt="PostgreSQL 18" />
  <img src="https://img.shields.io/badge/security-Server--Enforced%20RLS-success" alt="Server-Enforced RLS" />
  <img src="https://img.shields.io/badge/encryption-AES--256--GCM-blueviolet" alt="AES-256-GCM" />
</p>

---

## Why SafeHouse?

A family's critical paperwork — passports, birth certificates, immunization records, property deeds, wills, insurance policies, and business filings — lives scattered across desk drawers, email attachments, and smartphone photos. Usually only one person knows where everything is, making them a single point of failure.

Existing solutions fall into two flawed extremes:
- **Cloud storage & consumer drives**: Cluttered folder hierarchies with leaky link-sharing, unencrypted at rest or accessible to platform providers, and no concept of legal or family relationships.
- **Enterprise SaaS vaults**: Complex multi-tenant software with recurring subscriptions, tracking telemetry, and third-party data processor agreements.

**SafeHouse takes a different path:**
- **Strictly Single-Tenant**: One deployment per household. No multi-tenant code, no shared databases, and zero risk of cross-tenant leaks ([D2](docs/DECISIONS.md#d2--one-household-per-deployment-not-multi-tenant)).
- **Server-Enforced Permissions**: PostgreSQL Row-Level Security (RLS) guards every read and write. The browser does no security filtering ([D1](docs/DECISIONS.md#d1--permissions-resolve-on-the-server-always)).
- **Envelope Encryption**: Stored documents are sealed using AES-256-GCM with individual per-file Data Encryption Keys (DEKs) wrapped by an offline Master Key ([D12](docs/DECISIONS.md#d12--envelope-encryption-keys-separate-from-the-database)).
- **Zero-Cloud Machine Reading**: Optical character recognition (Tesseract 5), PDF text extraction, and ICAO 9303 MRZ parsing run 100% locally. No document byte ever touches a third-party AI or external API ([D26](docs/DECISIONS.md#d26--local-reading-nothing-leaves-this-machine)).
- **Family-Centric Access**: Relationships on the family tree (spouses, minor children, guardians, estate executors) directly derive access rights ([D16](docs/DECISIONS.md#d16--access-derives-from-the-family-circle)).

---

## Core Security & Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                     Client Browser (React)                    │
└───────────────────────────────▲───────────────────────────────┘
                                │ HTTP / Tailnet (HTTPS)
┌───────────────────────────────▼───────────────────────────────┐
│              SafeHouse Application Server (Node 24)           │
│  - Session & Step-Up Auth (`better-auth`)                     │
│  - Local Reading Pipeline (OpenCV, Tesseract 5, unpdf, mrz)   │
│  - Append-Only Activity Logger & Rate Limiter                 │
└──────────────┬────────────────────────────────┬───────────────┘
               │                                │
 (1) safehouse_auth connection     (2) safehouse_app connection
     Can only touch credentials,       Enforces Postgres RLS;
     accounts, and sessions.           no BYPASSRLS privilege.
               │                                │
┌──────────────▼────────────────────────────────▼───────────────┐
│              PostgreSQL 18 Database Engine                    │
│  - `perm` schema security definer functions                   │
│  - Row-Level Security (RLS) on records, documents & files     │
│  - Sealed AES-256-GCM identifiers & HMAC search fingerprints  │
└───────────────────────────────────────────────────────────────┘
                                │
                  Wrapped DEK & File Key Storage
                                │
┌───────────────────────────────▼───────────────────────────────┐
│            Encrypted File Store & Key Custody                 │
│  - `keys/safehouse.key`: Master KEK (printed & stored offline)│
│  - `storage/`: Sealed ciphertext chunks (AES-256-GCM)         │
└───────────────────────────────────────────────────────────────┘
```

1. **Three-Tier Database Boundary**:
   - `safehouse_auth`: Dedicated credential role. Reads and verifies password hashes and active sessions. Has zero permissions on documents, records, or files ([D24](docs/DECISIONS.md#d24--auth-reads-credentials-and-nothing-else)).
   - `safehouse_app`: Unprivileged runtime role. Bound by Row-Level Security policies on every table. Cannot see ungranted rows even in the event of an SQL injection.
   - `safehouse`: Database owner. Used strictly for schema setup and migrations. Never available to the running web application container ([D11](docs/DECISIONS.md#d11--the-application-connects-as-an-unprivileged-role)).
2. **Sealed Identifiers & Zero-Leak Search**:
   - Sensitive numbers (passport numbers, national IDs) are stored encrypted via AES-256-GCM and indexed with keyed HMAC-SHA256 fingerprints. Plaintext identifiers never sit readable in database dumps ([D35](docs/DECISIONS.md#d35--sealed-identifiers-and-keyed-fingerprints)).
3. **Step-Up Verification on Downloads**:
   - Having an active session allows browsing authorized document cards; downloading the underlying PDF or image requires re-entering account credentials ([D4](docs/DECISIONS.md#d4--downloading-needs-re-authentication)).
4. **Disaster Drills & Proven Restores**:
   - Backups are only as good as their restores. SafeHouse includes an automated drill tool (`npm run backup:drill`) that restores a backup into an isolated scratch database, verifies decryption keys, and checks SHA-256 digests ([D6](docs/DECISIONS.md#d6--backups-block-putting-real-documents-in)).
5. **Emergency Break-Glass**:
   - In a crisis, designated emergency contacts can unlock time-bounded emergency access to essential legal and medical records. Activation immediately triggers external alerts via webhooks and records an audit trail ([D19](docs/DECISIONS.md#d19--emergency-access-is-time-bounded-and-alerts-the-admin)).

---

## Features

- **Interactive Family Tree**: Pan, zoom, and navigate the entire household. Filter the vault instantly by selecting family members, spouses, or dependent children.
- **Individuals & Businesses Separation**: Switch smoothly between personal documents and business entities (contracts, leases, trading permits).
- **Intake & Paper Engine**: Upload raw smartphone photos; OpenCV detects edges, straightens perspective, and scales documents to true millimeter dimensions (ISO 7810 ID-1 cards, A4, Letter) with attached originals.
- **Smart Local Extraction**:
  - Automatically parses machine-readable zones (MRZ) on passports and national ID cards with check-digit validation.
  - OCR extraction with Tesseract 5 and native PDF text extraction.
  - Auto-categorizes insurance schedules and policy conditions without sending data to cloud LLMs.
- **Expiry Tracking & Staged Reminders**: Highlights expiring passports, visas, and permits at staged intervals (window entry, 7 days, 3 days, day-of) via ntfy, Telegram, or custom webhooks.
- **Access Console & View-As**: Household administrators can inspect and adjust fine-grained permissions, viewing the vault through the eyes of any household member to verify visibility rules.
- **Bulk Ingestion**: Rapidly sort, categorize, and propose metadata across batches of scanned papers.
- **SafeHouse at Night Aesthetic**: Tailored dark palette with Figtree and Red Hat Mono typography, tactile security stamps, and high-contrast accessibility.

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/) or Docker Engine with Docker Compose
- [Node.js](https://nodejs.org/) v24 or newer

### Windows Quick Start

Double-click `start.bat` or run:

```cmd
start.bat
```

`start.bat` checks for Node and Docker, copies `.env.example` to `.env` on a fresh run, installs npm packages, starts PostgreSQL, executes migrations, generates your master encryption key, and boots the development server at <http://localhost:4021>.

### Manual / Linux / macOS Setup

1. **Clone the repository**:
   ```sh
   git clone https://github.com/ghuuuu/safehouse.git
   cd safehouse
   ```

2. **Configure environment & secrets**:
   ```sh
   cp .env.example .env
   ```
   *Edit `.env` to set strong passwords before storing real family documents.*

3. **Generate master encryption key**:
   ```sh
   npm run key:make
   ```
   > [!IMPORTANT]
   > Write down the printed key on paper and store it in a physical safe or secure location offline. Without this key, document ciphertexts cannot be decrypted.

4. **Prepare storage & start database**:
   ```sh
   mkdir -p storage
   # On Linux: sudo chown 1000:1000 storage
   docker compose up -d db
   ```

5. **Install dependencies & run migrations**:
   ```sh
   npm install
   npm run db:migrate
   ```

6. **Start SafeHouse**:
   - **Production container**:
     ```sh
     docker compose up --build
     # App available at http://localhost:4020
     ```
   - **Development server**:
     ```sh
     npm run dev
     # App available at http://localhost:4021
     ```

7. **First Run**:
   Open <http://localhost:4020> (or <http://localhost:4021> in dev). On first visit, the setup screen allows you to register the household's primary administrator.

---

## Routine Operations & Backups

SafeHouse includes built-in operational tooling:

```sh
# Create an encrypted backup of the database and storage
npm run backup

# Execute a restore verification drill into a scratch database
npm run backup:drill

# Run backup, drill, and schema migration in sequence
npm run upgrade

# Restore a backup onto a clean instance
npm run restore -- ./backups/<backup-folder>
```

For complete instructions on key management, disaster recovery, and scheduled tasks, see [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

---

## Documentation

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — Product specification, user personas, and design goals.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — Comprehensive record of architectural decisions (D1–D44) and rationale.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — Runbook covering backups, drills, upgrades, and disaster recovery.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — Completed milestones (Acts I–III) and upcoming developments.
- [`docs/DESIGN.md`](docs/DESIGN.md) — Visual tokens, Night palette, typography, and motion guidelines.
- [`CLAUDE.md`](CLAUDE.md) — Architecture invariants and rules for AI-assisted development.

---

## Project Roadmap

- [x] **Act I: The Vault Foundation** — Envelope encryption, RLS policies, step-up download checks, append-only audit log, verified backup drills.
- [x] **Act II: Intelligence & Structure** — Local OCR (Tesseract + PDF), MRZ check-digit parsing, staged expiry reminders, family tree visualization, access console, sealed identifier search, bulk ingestion.
- [x] **Act III: Hardening & Refinement** — Settings, 2FA with authenticator apps, break-glass emergency windows with webhook alerts, OpenCV perspective warp & millimeter-accurate PDF generation.
- [ ] **First-Run Empty Household Wizard** — Interactive onboarding flow to build a custom family tree without sample fixtures ([Step 18](docs/ROADMAP.md#milestone-1-first-run-onboarding-wizard-step-18-unblocked--v020)).
- [ ] **Mobile Capture Ergonomics** — In-browser camera stream capture over Tailscale with real-time border detection.
- [ ] **Recovery Key Verification** — Offline paper key check utility and admin-assisted 2FA recovery.

For in-depth details, see [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Contributing & Security

This application is engineered specifically to protect sensitive personal, legal, and financial records. When contributing:

- **Zero-Secret Commits**: Never commit `.env` files, `.key` files, certificates, or real document scans.
- **Fictional Data Only**: All test fixtures, mock data, and screenshots must use fictional names (`@example.invalid` addresses and non-existent identifiers).
- **Test Coverage**: All changes must pass `npm test`, `npm run lint`, and `npm run typecheck`. Permission rules must be tested before implementation.

---

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
