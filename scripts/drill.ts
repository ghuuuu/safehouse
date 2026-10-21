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
 * It never touches the live store, and writes one row to the live database: a
 * pass, in `backup_drills`, which is how the admin's dashboard knows the
 * schedule is still running (D38). The one-line summary at the end is the only
 * thing worth reading when this runs unattended.
 *
 *   npm run backup:drill    → the newest backup in ./backups
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import postgres from "postgres";

import { openDump, type Manifest } from "../app/backup.server";
import { keyIdOf, openFile } from "../app/crypto.server";
import { openIdentifier } from "../app/field-crypto.server";
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

// The newest in ./backups unless told which, so a schedule is one line:
// `npm run backup && npm run backup:drill`. Backup ids sort by time.
const newest = (await readdir("./backups").catch(() => []))
  .filter((name) => name.startsWith("safehouse-"))
  .sort()
  .at(-1);
const target = process.argv[2] ?? (newest && join("./backups", newest));

if (!target) {
  console.error("Which backup? npm run backup:drill -- ./backups/safehouse-...");
  process.exit(1);
}

const backupDir = resolve(target);

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

// 2b. With the grants the app signs in and reads with. They were made by
// migrations, which do not run again on restore, so a dump without them
// restores a vault nobody can sign in to. Backups from before D38 are like that.
{
  const restored = postgres(withDatabase(ownerUrl, DRILL_DATABASE), { max: 1, onnotice: () => {} });
  try {
    const [{ granted }] = await restored`
      select has_table_privilege('safehouse_app', 'public.documents', 'SELECT')
         and has_table_privilege('safehouse_auth', 'public.users', 'SELECT') as granted
    `;
    if (!granted) {
      console.error(
        "Drill FAILED: this backup restores without the grants the app connects with,\n" +
          "so nobody could sign in to it. It predates D38; take a new backup.",
      );
      process.exit(1);
    }
  } finally {
    await restored.end();
  }
}
console.log("  the app's grants came back with it");

// 3. A real document comes back out of it, byte for byte.
const drill = postgres(withDatabase(ownerUrl, DRILL_DATABASE), { max: 1, onnotice: () => {} });
let checked = 0;
let missing = 0;
let lost = 0;
let retired = 0;
let identifiers = 0;
let retiredIdentifiers = 0;

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
      // The fixture's rows have no blob behind them, and say so in their key.
      // Any other row without one is a document this backup lost.
      if ((file.storage_key as string).startsWith("fixture/")) missing += 1;
      else lost += 1;
      continue;
    }

    const wrappedDek = Buffer.from(file.wrapped_dek as Buffer);

    // A file wrapped under a key this machine no longer holds is not a restore
    // failure, and must not be reported as one. It means the key-encryption key
    // was replaced after this row was written — a deliberate rotation that did
    // not finish, or a key regenerated with documents already filed. The backup
    // is intact; what is missing is the key, and D12 is explicit that losing it
    // loses the data. Checked by comparing key ids rather than by catching the
    // error, because the same exception also covers cases worth shouting about.
    if (!keyIdOf(wrappedDek).equals(provider.keyId())) {
      retired += 1;
      continue;
    }

    const plaintext = openFile(
      {
        stored: sealed,
        nonce: Buffer.from(file.nonce as Buffer),
        wrappedDek,
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

  // Every sealed identifier opens (D35). Not counted per row in the output:
  // the numbers are the point of the check and must not be printed. A backup
  // from before 0013 has no such column, and its numbers are in the dump in the
  // clear; `npm run identifiers:seal` after restoring it seals them.
  const [{ has }] = await drill`
    select exists (
      select 1 from information_schema.columns
      where table_name = 'documents' and column_name = 'identifier_sealed'
    ) as has
  `;
  if (has) {
    const rows = await drill`
      select id, identifier_sealed from documents where identifier_sealed is not null
    `;
    for (const row of rows) {
      const sealedValue = Buffer.from(row.identifier_sealed as Buffer);
      if (!keyIdOf(sealedValue).equals(provider.keyId())) {
        retiredIdentifiers += 1;
        continue;
      }
      // Throws on a tag mismatch, which fails the drill: that is damage, not a key.
      openIdentifier(sealedValue, row.id as string, provider);
      identifiers += 1;
    }
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

if (retired > 0) {
  // Said before the verdict, because it is the one line that needs acting on and
  // a passing drill is otherwise read as "nothing to see".
  console.error(
    `  ${retired} file${retired === 1 ? "" : "s"} wrapped under a key-encryption key\n` +
      `  this machine no longer has. The backup holds them; nothing can open them.\n` +
      `  Either restore the old key file, or accept that those files are gone (D12).`,
  );
}

if (retiredIdentifiers > 0) {
  console.error(
    `  ${retiredIdentifiers} identifier${retiredIdentifiers === 1 ? "" : "s"} sealed under a key this machine no longer has (D12).`,
  );
}

if (lost > 0) {
  console.error(
    `Drill FAILED: ${lost} file${lost === 1 ? " is" : "s are"} in the restored database ` +
      `but not in the backup. Restored, ${lost === 1 ? "that document" : "those documents"} would not open.`,
  );
  process.exit(1);
}

if (checked === 0 && missing + retired > 0) {
  console.error(
    `Drill FAILED: ${missing + retired} file rows restored and not one of them ` +
      `could be opened and checked.`,
  );
  process.exit(1);
}

// Tell the vault, so the admin's dashboard knows backups are being proven and
// notices when they stop (D38). The one write this makes to the live database.
const live = postgres(ownerUrl, { max: 1, onnotice: () => {} });
try {
  await live`
    insert into backup_drills (backup_id, backup_taken_at)
    values (${manifest.backupId}, ${manifest.createdAt})
  `;
} catch (error) {
  // A vault from before 0016, mid-upgrade: `npm run upgrade` drills before it
  // migrates. The drill still passed; there is just nowhere to say so yet.
  if ((error as { code?: string }).code !== "42P01") throw error;
  console.log("  (not recorded: this vault predates backup_drills)");
} finally {
  await live.end();
}

console.log(
  `Drill passed: ${manifest.counts.documents} documents restored, ` +
    `${checked} files opened and verified byte for byte` +
    (missing > 0 ? `, ${missing} rows with no stored blob (fixture rows have none)` : "") +
    (retired > 0 ? `, ${retired} unopenable under the current key` : "") +
    `, ${identifiers} sealed identifiers opened`,
);

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
