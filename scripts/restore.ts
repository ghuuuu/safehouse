/**
 * Put a backup back, into the live vault.
 *
 *   npm run restore -- ./backups/safehouse-2026-10-06T...
 *
 * This is the command nobody runs until the worst day, so it refuses more than
 * it does. It will not restore over a database that still has accounts in it
 * unless told to in as many words, because the common case for running this by
 * accident is "I meant to run the drill".
 *
 * Prove the backup first with `npm run backup:drill`. That restores the same
 * bytes into a throwaway database and opens a document out of them, and costs
 * nothing if it turns out the backup was never any good.
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";

import postgres from "postgres";

import { openDump, type Manifest } from "../app/backup.server";
import { keyProviderFromFile } from "../app/keys.server";

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
    const err: string[] = [];

    child.stderr.on("data", (chunk: Buffer) => err.push(chunk.toString()));
    child.stdout.resume();
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0
        ? fulfil("")
        : fail(new Error(`${command} exited ${code}: ${err.join("").trim()}`)),
    );

    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

const [target, force] = [process.argv[2], process.argv.includes("--force")];

if (!target) {
  console.error("Which backup? npm run restore -- ./backups/safehouse-...");
  process.exit(1);
}

const backupDir = resolve(target);
const provider = keyProviderFromFile(required("SAFEHOUSE_KEY_FILE"));
const storeDir = resolve(required("SAFEHOUSE_STORAGE_DIR"));
const ownerUrl = required("DATABASE_URL");

const manifest = JSON.parse(
  await readFile(join(backupDir, "manifest.json"), "utf8"),
) as Manifest;

const dump = openDump(
  await readFile(join(backupDir, "database.enc")),
  manifest,
  provider,
);

if (createHash("sha256").update(dump).digest("hex") !== manifest.database.sha256) {
  console.error("This backup's dump does not match its own digest. Stopping.");
  process.exit(1);
}

const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
let existing = 0;
try {
  const [row] = await sql`select count(*)::int as n from users`;
  existing = row.n;
} catch {
  // No tables yet: restoring into an empty database is the ordinary case.
} finally {
  await sql.end();
}

console.log(`Backup:   ${manifest.backupId}, taken ${manifest.createdAt}`);
console.log(`Contains: ${manifest.counts.documents} documents, ${manifest.counts.storedBlobs} files`);
console.log(`Into:     the live vault, which currently has ${existing} accounts`);

if (existing > 0 && !force) {
  console.error("");
  console.error("Refusing: this would replace a vault that has accounts in it.");
  console.error("Run the drill instead to check this backup without touching anything:");
  console.error(`  npm run backup:drill -- ${backupDir}`);
  console.error("If replacing the live vault is genuinely what you want, add --force.");
  process.exit(1);
}

if (existing > 0) {
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await ask.question(
    `Type the number of accounts about to be replaced (${existing}) to continue: `,
  );
  ask.close();

  if (answer.trim() !== String(existing)) {
    console.error("Not restoring.");
    process.exit(1);
  }
}

// The dump grants to the app and sign-in roles, so they must exist first. On a
// new machine they do not; on this one, setting them up again changes nothing.
console.log("Making sure the application's roles exist…");
await run("node", ["scripts/db-setup.mjs"]);

// Never over the live database. The dump's own `drop ... if exists` lines
// stop at the first object a later migration made depend on what they drop,
// and every line before that has already happened: a vault restored over one
// migrated past the backup was left half-dropped. So the dump goes into a
// new, empty database beside it, in one transaction, and only a complete
// restore is swapped in. The database it replaces is renamed, not dropped.
const live = new URL(ownerUrl).pathname.slice(1);
const restoring = `${live}_restoring`;
const aside = `${live}_before_restore_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
const maintenanceUrl = new URL(ownerUrl);
maintenanceUrl.pathname = "/postgres";
const maintenance = postgres(maintenanceUrl.toString(), { max: 1, onnotice: () => {} });

try {
  console.log("Restoring the database beside the live one…");
  await maintenance.unsafe(`drop database if exists "${restoring}"`);
  await maintenance.unsafe(`create database "${restoring}"`);
  try {
    await run(
      "docker",
      ["compose", "exec", "-T", "db", "psql", "-q", "-1", "-v", "ON_ERROR_STOP=1", "-U", "safehouse", "-d", restoring],
      dump,
    );
  } catch (error) {
    await maintenance.unsafe(`drop database if exists "${restoring}"`);
    console.error("The backup did not restore. The live vault was not touched.");
    throw error;
  }

  console.log("Swapping it in…");
  try {
    await maintenance.unsafe(`alter database "${live}" rename to "${aside}"`);
  } catch (error) {
    await maintenance.unsafe(`drop database if exists "${restoring}"`);
    console.error("Could not set the live database aside. Is the app still running?");
    console.error("Stop it (docker compose stop app) and run this again. Nothing was changed.");
    throw error;
  }
  await maintenance.unsafe(`alter database "${restoring}" rename to "${live}"`);
} finally {
  await maintenance.end();
}

console.log("Restoring the document store…");
await cp(join(backupDir, "storage"), storeDir, { recursive: true, force: true });

console.log("");
console.log("Restored. Run `npm run db:migrate` before starting the app: it brings an");
console.log("older backup's schema forward and seals any identifier it holds in the clear.");
console.log("");
console.log(`The database it replaced is kept as ${aside}. Once the vault is`);
console.log("working, remove it with:");
console.log(`  docker compose exec db dropdb -U safehouse ${aside}`);
