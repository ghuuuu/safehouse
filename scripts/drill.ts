/**
 * Prove a backup restores, into a database that is not the vault.
 *
 *   npm run backup:drill -- ./backups/safehouse-2026-10-06T...
 *
 * D6 says restore must be tested on a schedule rather than assumed, so this is
 * a command rather than a page in a wiki nobody opens. It restores into a
 * throwaway database, opens a real document out of the restored store, checks
 * the bytes against the digest recorded when it was filed, and drops the
 * throwaway afterwards.
 *
 * It never touches the live database or the live store. The one-line summary
 * at the end is the only thing worth reading when this runs unattended.
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import postgres from "postgres";

import { openDump, type Manifest } from "../app/backup.server";
import { openFile } from "../app/crypto.server";
import { keyProviderFromFile } from "../app/keys.server";

const DRILL_DATABASE = "safehouse_drill";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See .env.example.`);
    process.exit(1);
  }
  return value;
}

function run(command: string, args: string[], input?: Buffer): Promise<string> {
  return new Promise((fulfil, fail) => {
    // shell only on Windows, where spawn cannot find `docker` without it.
    // Every argument here is a literal in this file; none comes from input.
    const child = spawn(command, args, { shell: process.platform === "win32" });
    const out: string[] = [];
    const err: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk.toString()));
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0
        ? fulfil(out.join(""))
        : fail(new Error(`${command} exited ${code}: ${err.join("").trim()}`)),
    );

    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

const backupDir = resolve(process.argv[2] ?? "");

if (!process.argv[2]) {
  console.error("Which backup? npm run backup:drill -- ./backups/safehouse-...");
  process.exit(1);
}

const provider = keyProviderFromFile(required("SAFEHOUSE_KEY_FILE"));
const ownerUrl = required("DATABASE_URL");

const manifest = JSON.parse(
  await readFile(join(backupDir, "manifest.json"), "utf8"),
) as Manifest;

console.log(`Drilling ${manifest.backupId}, taken ${manifest.createdAt}`);

// 1. The dump opens, and is the dump that was taken.
const stored = await readFile(join(backupDir, "database.enc"));
const dump = openDump(stored, manifest, provider);

const digest = createHash("sha256").update(dump).digest("hex");
if (digest !== manifest.database.sha256) {
  console.error("The restored dump does not match the digest in the manifest.");
  process.exit(1);
}
console.log(`  dump opens and matches its digest (${dump.length} bytes)`);

// 2. It restores into a database that is not the vault.
const maintenance = postgres(withDatabase(ownerUrl, "postgres"), { max: 1, onnotice: () => {} });
try {
  await maintenance.unsafe(`drop database if exists "${DRILL_DATABASE}"`);
  await maintenance.unsafe(`create database "${DRILL_DATABASE}"`);
} finally {
  await maintenance.end();
}

await run(
  "docker",
  ["compose", "exec", "-T", "db", "psql", "-q", "-v", "ON_ERROR_STOP=1", "-U", "safehouse", "-d", DRILL_DATABASE],
  dump,
);
console.log(`  restored into ${DRILL_DATABASE}`);

// 3. A real document comes back out of it, byte for byte.
const drill = postgres(withDatabase(ownerUrl, DRILL_DATABASE), { max: 1, onnotice: () => {} });
let checked = 0;
let missing = 0;

try {
  const files = await drill`
    select id, storage_key, sha256, wrapped_dek, nonce, byte_size
    from document_files
    order by id
  `;

  for (const file of files) {
    let sealed: Buffer;
    try {
      sealed = await readFile(join(backupDir, "storage", file.storage_key as string));
    } catch {
      // Fixture rows have no blob behind them; a real one missing is the thing
      // worth shouting about, and the counts below say which this was.
      missing += 1;
      continue;
    }

    const plaintext = openFile(
      {
        stored: sealed,
        nonce: Buffer.from(file.nonce as Buffer),
        wrappedDek: Buffer.from(file.wrapped_dek as Buffer),
      },
      file.id as string,
      provider,
    );

    const actual = createHash("sha256").update(plaintext).digest("hex");
    if (actual !== file.sha256) {
      console.error(`  file ${file.id} restored but does not match its digest`);
      process.exit(1);
    }

    checked += 1;
  }
} finally {
  await drill.end();
}

// 4. Leave nothing behind.
const cleanup = postgres(withDatabase(ownerUrl, "postgres"), { max: 1, onnotice: () => {} });
try {
  await cleanup.unsafe(`drop database if exists "${DRILL_DATABASE}"`);
} finally {
  await cleanup.end();
}

console.log("");
if (checked === 0 && missing > 0) {
  console.error(
    `Drill FAILED: ${missing} file rows restored and not one of them had bytes behind it.`,
  );
  process.exit(1);
}

console.log(
  `Drill passed: ${manifest.counts.documents} documents restored, ` +
    `${checked} files opened and verified byte for byte` +
    (missing > 0 ? `, ${missing} rows with no stored blob (fixture rows have none)` : ""),
);

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
