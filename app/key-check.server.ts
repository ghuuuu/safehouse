/**
 * Refuse to run under a key that opens none of the vault (D31).
 *
 * A server holding the wrong key-encryption key starts, lists the vault, and
 * fails only when somebody opens a file. Worse, it files every new upload
 * under the wrong key, so the vault ends up split across two keys, and getting
 * it back then needs both. Asking once at boot turns that into a server that
 * will not start and says which key it expected.
 *
 * Key ids are four bytes of a hash of the key and reveal nothing about it,
 * which is why they can go in an error message.
 */

import { sql } from "drizzle-orm";

import { getDb, type VaultTransaction } from "./db.server";
import { keys, type KeyProvider } from "./keys.server";

/** Every key id a file in the vault is wrapped under, whoever is asking. */
export async function keyIdsInUse(
  db: Pick<VaultTransaction, "execute"> = getDb(),
): Promise<Buffer[]> {
  const rows = await db.execute<{ key_id: Buffer }>(
    sql`select key_id from public.vault_key_ids() as key_id`,
  );
  return [...rows].map((row) => Buffer.from(row.key_id));
}

/**
 * Throws when this key opens nothing in a vault that has files. Returns a
 * warning when it opens some of them, and null when there is nothing to say.
 */
export function judgeKey(provider: KeyProvider, inUse: Buffer[]): string | null {
  if (inUse.length === 0) return null;

  const mine = provider.keyId();
  const others = inUse.filter((id) => !id.equals(mine)).map((id) => id.toString("hex"));

  if (others.length === inUse.length) {
    throw new Error(
      `The key in SAFEHOUSE_KEY_FILE (id ${mine.toString("hex")}) opens none of ` +
        `the files in this vault, which are wrapped under ${others.join(", ")}. ` +
        `Refusing to start: everything filed now would be sealed under the wrong ` +
        `key. Put the right key file back. Losing it loses the files (D12).`,
    );
  }

  if (others.length > 0) {
    return (
      `Some files in this vault are wrapped under a key this server does not ` +
      `hold (${others.join(", ")}). A rotation did not finish, or the key file ` +
      `was replaced after they were filed. They will not open (D12).`
    );
  }

  return null;
}

/** Run at boot. Also what stops the server when the key file is missing. */
export async function checkKeyAtBoot(): Promise<void> {
  const warning = judgeKey(keys(), await keyIdsInUse());
  if (warning) console.warn(warning);
}
