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

console.log("Restoring the database…");
await run(
  "docker",
  ["compose", "exec", "-T", "db", "psql", "-q", "-v", "ON_ERROR_STOP=1", "-U", "safehouse", "-d", "safehouse"],
  dump,
);

console.log("Restoring the document store…");
await cp(join(backupDir, "storage"), storeDir, { recursive: true, force: true });

console.log("");
console.log("Restored. The roles the application connects as are not in a dump,");
console.log("so run `npm run db:setup` before starting the app.");
