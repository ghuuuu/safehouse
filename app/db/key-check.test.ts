/**
 * The server refuses to start under a key that opens none of the vault (D31).
 *
 * Two halves. The database half: `vault_key_ids()` answers with nobody asking,
 * gives out key ids and nothing else, and is refused to the sign-in role. The
 * judgement half: which answers mean "run", "run and say so", and "stop".
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { judgeKey, keyIdsInUse } from "../key-check.server";
import { keyProviderFrom } from "../keys.server";
import { fileDocument } from "../upload.server";
import { OWNER, USER } from "./fixture";
import {
  asAuthRole,
  asNobody,
  closeTestDatabase,
  prepareTestDatabase,
  refusal,
} from "./test-harness";

let asUser: typeof import("../db.server").asUser;
let keyFile: string;

class Rollback extends Error {}

beforeAll(async () => {
  await prepareTestDatabase();

  const store = await mkdtemp(join(tmpdir(), "safehouse-key-check-"));
  process.env.SAFEHOUSE_STORAGE_DIR = store;

  // Its own key, so a file sealed here is recognisably this test's.
  keyFile = join(store, "test.key");
  await writeFile(keyFile, randomBytes(32).toString("hex"));
  process.env.SAFEHOUSE_KEY_FILE = keyFile;

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
}, 60_000);

afterAll(closeTestDatabase);

describe("what the database will say about keys", () => {
  test("the key a file was just sealed under, even with nobody asking", async () => {
    const { keys } = await import("../keys.server");
    let seen: Buffer[] = [];

    // Filed and rolled back in one transaction, because every test file shares
    // the database and a committed row would change what the others see.
    await asUser(USER.maya, async (db) => {
      await fileDocument(db, {
        ownerId: OWNER.maya,
        category: "general",
        title: "TEST-KEY-CHECK sealed under this test's key",
        mime: "application/pdf",
        bytes: Buffer.from("%PDF-1.4 fictional TEST-KEY-CHECK", "utf8"),
      });

      // The question is asked at boot, before anybody has signed in. A query
      // with no user set sees no files at all, so this is the case that has
      // to work.
      await db.execute(sql`select set_config('safehouse.user_id', '', true)`);
      seen = await keyIdsInUse(db);
      throw new Rollback();
    }).catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });

    expect(seen.some((id) => id.equals(keys().keyId()))).toBe(true);
  });

  test("fixture rows, which hold no real wrapped key, are not counted as a key", async () => {
    const rows = await asNobody((sql) => sql`select key_id from vault_key_ids() as key_id`);

    // What the placeholder would look like if it were read as a key: the four
    // bytes after its first.
    const placeholder = Buffer.from("fixture", "utf8").subarray(1, 5);

    expect(rows.some((row) => placeholder.equals(row.key_id as Buffer))).toBe(false);
  });

  test("the sign-in role cannot ask", async () => {
    const refused = await refusal(() =>
      asAuthRole((sql) => sql`select key_id from vault_key_ids() as key_id`),
    );

    expect(refused?.code).toBe("42501");
  });
});

describe("what the server does with the answer", () => {
  const current = keyProviderFrom(randomBytes(32));
  const other = keyProviderFrom(randomBytes(32)).keyId();

  test("an empty vault runs under any key", () => {
    expect(judgeKey(current, [])).toBeNull();
  });

  test("a vault wrapped under this key runs quietly", () => {
    expect(judgeKey(current, [current.keyId()])).toBeNull();
  });

  test("a vault wrapped under this key and another runs, and says so", () => {
    expect(judgeKey(current, [current.keyId(), other])).toMatch(
      new RegExp(other.toString("hex")),
    );
  });

  test("a vault this key opens nothing of does not run at all", () => {
    expect(() => judgeKey(current, [other])).toThrow(
      new RegExp(`${current.keyId().toString("hex")}.*${other.toString("hex")}`, "s"),
    );
  });
});
