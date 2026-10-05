/**
 * Generate the key-encryption key every document key is wrapped with (D12).
 *
 * Run once per deployment, before the first upload. Running it again on an
 * existing vault would make every document in it unreadable, so it refuses to
 * overwrite a key that is already there — the refusal is the whole point of
 * this being a script rather than a line in a README.
 *
 * The key is printed once, here, deliberately. D12 puts its custody — printed,
 * offline, somewhere that is not this machine — on the household rather than on
 * the server, and a key nobody ever saw cannot be kept anywhere.
 */

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const path = resolve(
  process.argv[2] ?? process.env.SAFEHOUSE_KEY_FILE ?? "./keys/safehouse.key",
);

if (existsSync(path)) {
  console.error(`A key already exists at ${path}. Refusing to overwrite it.`);
  console.error(
    "Every document in this vault is wrapped with it; replacing it would lose all of them.",
  );
  console.error("Rotation re-wraps data keys instead, and keeps both keys while it runs.");
  process.exit(1);
}

const key = randomBytes(32).toString("hex");

mkdirSync(dirname(path), { recursive: true });
// 0600 so the key is not readable by other accounts on this machine. Windows
// ignores the mode; the file still lands under a gitignored directory.
writeFileSync(path, `${key}\n`, { mode: 0o600 });

console.log(`Wrote a new key-encryption key to ${path}`);
console.log("");
console.log(`  ${key}`);
console.log("");
console.log("Write it down and put it somewhere that is not this machine, now.");
console.log("Every document ever stored in this vault is unreadable without it,");
console.log("and nothing anywhere else holds a copy — not the database, not a");
console.log("backup, not this program (D12).");
