/**
 * Make a backup: the database encrypted, the document store copied as it is.
 *
 *   npm run backup            → ./backups/safehouse-<timestamp>
 *   npm run backup -- /mnt/x  → somewhere else
 *
 * Run it with the database up. It shells out to pg_dump inside the db
 * container, because that is where a version-matched pg_dump lives in a
 * Docker Compose deployment (D3) and installing Postgres on the host to get one
 * is a worse answer.
 *
 * The key file is not in the result. Nothing here reads it except to encrypt
 * with it, and the finished backup is searched for it before this exits.
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import postgres from "postgres";

import {
  assertNoKeyMaterial,
  listBlobs,
  MANIFEST_VERSION,
  sealDump,
  type Manifest,
} from "../app/backup.server";
import { keyProviderFromFile } from "../app/keys.server";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See .env.example.`);
    process.exit(1);
  }
  return value;
}

/** Run a command and collect stdout, failing loudly rather than silently. */
function run(command: string, args: string[]): Promise<Buffer> {
  return new Promise((fulfil, fail) => {
    // shell only on Windows, where spawn cannot find `docker` without it.
    // Every argument here is a literal in this file; none comes from input.
    const child = spawn(command, args, { shell: process.platform === "win32" });
    const out: Buffer[] = [];
    const err: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk.toString()));
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0
        ? fulfil(Buffer.concat(out))
        : fail(new Error(`${command} exited ${code}: ${err.join("").trim()}`)),
    );
  });
}

const keyFile = required("SAFEHOUSE_KEY_FILE");
const storeDir = resolve(required("SAFEHOUSE_STORAGE_DIR"));
const databaseUrl = required("DATABASE_URL");
const provider = keyProviderFromFile(keyFile);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupId = `safehouse-${stamp}`;
const destination = resolve(process.argv[2] ?? "./backups", backupId);

if (resolve(keyFile).startsWith(destination)) {
  console.error("Refusing to write a backup into the directory holding the key.");
  process.exit(1);
}

await mkdir(destination, { recursive: true });

console.log(`Dumping the database…`);
const dump = await run("docker", [
  "compose",
  "exec",
  "-T",
  "db",
  "pg_dump",
  "--clean",
  "--if-exists",
  "--no-owner",
  // Privileges are kept. Every grant the app and sign-in roles hold was made by
  // a migration, and a migration does not run again on restore: a dump without
  // them restores a vault that refuses the app everything (found in Step 19).
  "-U",
  "safehouse",
  "safehouse",
]);

if (dump.length === 0) {
  console.error("pg_dump produced nothing. Is the database running?");
  process.exit(1);
}

const { stored, database } = sealDump(dump, backupId, provider);
await writeFile(join(destination, "database.enc"), stored);

console.log(`Copying the document store…`);
await cp(storeDir, join(destination, "storage"), { recursive: true }).catch(
  async (error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A vault with nothing filed yet still deserves a backup.
    await mkdir(join(destination, "storage"), { recursive: true });
  },
);

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
let counts: Manifest["counts"];
try {
  const [row] = await sql`
    select
      (select count(*)::int from documents) as documents,
      (select count(*)::int from document_files) as files
  `;
  counts = {
    documents: row.documents,
    files: row.files,
    storedBlobs: (await listBlobs(join(destination, "storage")).catch(() => []))
      .length,
  };
} finally {
  await sql.end();
}

const manifest: Manifest = {
  version: MANIFEST_VERSION,
  backupId,
  createdAt: new Date().toISOString(),
  database,
  counts,
};

await writeFile(
  join(destination, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

await assertNoKeyMaterial(destination, provider.kek());

if (counts.files !== counts.storedBlobs) {
  // Not fatal — a row whose blob is missing is a problem that predates this
  // backup — but a backup that quietly records fewer files than the database
  // knows about is how a restore surprises somebody.
  console.warn(
    `Warning: the database lists ${counts.files} files and the store holds ` +
      `${counts.storedBlobs}. The backup records both numbers.`,
  );
}

console.log("");
console.log(`Backup written to ${destination}`);
console.log(
  `  ${counts.documents} documents, ${counts.storedBlobs} sealed files, database encrypted`,
);
console.log("");
console.log("The key is not in it. Without the key this backup is noise, and");
console.log("nothing anywhere else holds a copy of the key (D12).");
console.log("");
console.log(`Prove it restores: npm run backup:drill -- ${destination}`);

// Read back what was written, so "the backup exists" and "the backup opens"
// are not the same claim resting on one write.
const written = await readFile(join(destination, "database.enc"));
if (written.length !== stored.length) {
  console.error("The backup on disk is not the size it was written as.");
  process.exit(1);
}
