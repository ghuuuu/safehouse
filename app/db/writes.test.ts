/**
 * What the application may put into the vault, and for whom.
 *
 * Written before the policies they test (CLAUDE.md). Until the migration that
 * follows this file lands, every one of these fails with a privilege error,
 * which is the correct answer from a database that has never had a write
 * policy on a vault table.
 *
 * The question a write policy asks is not the question a read policy asks.
 * "May see this record" is not "may add a document to it", and a `with check`
 * that was copied from a `using` clause is how a document ends up filed under
 * somebody who never agreed to hold it.
 *
 * Nothing here commits: `asUserRollingBack` rolls every transaction back, so
 * the fixture the rest of the suite reasons about is the fixture it started
 * with.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { DOCUMENT, OWNER, RECORD, USER } from "./fixture";
import {
  asUserRollingBack,
  closeTestDatabase,
  prepareTestDatabase,
  refusal,
} from "./test-harness";

beforeAll(async () => {
  await prepareTestDatabase();
}, 60_000);

afterAll(async () => {
  await closeTestDatabase();
});

/** Fixed ids, so a failed rollback is obvious rather than mysterious. */
const NEW = {
  record: "00000000-0000-4000-8000-000000000900",
  document: "00000000-0000-4000-8000-000000000901",
  file: "00000000-0000-4000-8000-000000000902",
};

type Sql = Parameters<Parameters<typeof asUserRollingBack>[1]>[0];

function insertRecord(
  sql: Sql,
  ownerId: string,
  options: { private?: boolean; id?: string } = {},
) {
  return sql`
    insert into records (id, owner_id, category, kind, title, is_private)
    values (
      ${options.id ?? NEW.record}, ${ownerId}, 'general', 'note',
      'Filed by a test', ${options.private ?? false}
    )
  `;
}

function insertDocument(sql: Sql, recordId: string) {
  // Version 9: the licence record already holds versions 1 and 2, and
  // `(record_id, version_no)` is unique. A collision here would look like a
  // policy refusal to a reader skimming the failure.
  return sql`
    insert into documents (id, record_id, version_no, is_current)
    values (${NEW.document}, ${recordId}, 9, false)
  `;
}

function insertFile(sql: Sql, documentId: string) {
  const sealed = Buffer.from("sealed");
  return sql`
    insert into document_files
      (id, document_id, page_no, storage_key, sha256, byte_size, mime, wrapped_dek, nonce)
    values (
      ${NEW.file}, ${documentId}, 1, 'test/written-by-a-test',
      'test-hash', 6, 'application/pdf', ${sealed}, ${sealed}
    )
  `;
}

describe("who may file a record", () => {
  test("an admin may file for anybody", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => insertRecord(sql, OWNER.nadia)),
    );

    expect(error).toBeNull();
  });

  test("an individual may file for an owner they can already see", async () => {
    // Daniel can see his own papers and his household's. A household filing
    // cabinet that only one person may add to is a filing cabinet nobody uses.
    const error = await asUserRollingBack(USER.daniel, (sql) =>
      refusal(() => insertRecord(sql, OWNER.daniel)),
    );

    expect(error).toBeNull();
  });

  test("an individual may file for the household itself", async () => {
    const error = await asUserRollingBack(USER.maya, (sql) =>
      refusal(() => insertRecord(sql, OWNER.household)),
    );

    expect(error).toBeNull();
  });

  test("an individual may not file for an owner outside their reach", async () => {
    // Nadia is Daniel's ex-wife's side of the tree. Maya cannot see her, and
    // must not be able to put paperwork in her name.
    const error = await asUserRollingBack(USER.maya, (sql) =>
      refusal(() => insertRecord(sql, OWNER.nadia)),
    );

    expect(error?.code).toBe("42501");
  });

  test("a third party may not file at all, not even for the business they hold", async () => {
    // Sam reaches Hale Consulting's papers by grant (D18). Reading somebody's
    // filing cabinet is not permission to put things in it.
    const error = await asUserRollingBack(USER.sam, (sql) =>
      refusal(() => insertRecord(sql, OWNER.hale)),
    );

    expect(error?.code).toBe("42501");
  });

  test("an emergency contact may not file during an open window", async () => {
    // Break-glass is a read. A window that could also write is a window that
    // can plant a document (D19).
    const error = await asUserRollingBack(USER.medic, (sql) =>
      refusal(() => insertRecord(sql, OWNER.ivy)),
    );

    expect(error?.code).toBe("42501");
  });

  test("a disabled account may not file for the owner it used to reach", async () => {
    const error = await asUserRollingBack(USER.tenant, (sql) =>
      refusal(() => insertRecord(sql, OWNER.hale)),
    );

    expect(error?.code).toBe("42501");
  });

  test("an account with nobody attached to it may not file anywhere", async () => {
    const error = await asUserRollingBack(USER.stranger, (sql) =>
      refusal(() => insertRecord(sql, OWNER.household)),
    );

    expect(error?.code).toBe("42501");
  });

  test("a transaction with no user set may not file", async () => {
    // The shape of a request that skipped `withVault` — `current_app_user()`
    // is null, every policy's predicate is unsatisfied, and the write is
    // refused rather than attributed to nobody.
    const error = await asUserRollingBack(null, (sql) =>
      refusal(() => insertRecord(sql, OWNER.household)),
    );

    expect(error?.code).toBe("42501");
  });
});

describe("privacy is not a way to write into the dark", () => {
  test("an individual may mark their own record private", async () => {
    const error = await asUserRollingBack(USER.ivy, (sql) =>
      refusal(() => insertRecord(sql, OWNER.ivy, { private: true })),
    );

    expect(error).toBeNull();
  });

  test("an individual may not file a private record for somebody else", async () => {
    // It would vanish from its author the moment it was written — a row they
    // created and cannot see. The admin can, because the admin sees everything
    // private included (D17), so nothing disappears.
    const error = await asUserRollingBack(USER.maya, (sql) =>
      refusal(() => insertRecord(sql, OWNER.rose, { private: true })),
    );

    expect(error?.code).toBe("42501");
  });

  test("whatever is filed is visible to whoever filed it", async () => {
    // The black-hole test. A `with check` wider than the `using` clause writes
    // rows the author cannot read back, which reads as data loss.
    const seen = await asUserRollingBack(USER.daniel, async (sql) => {
      await insertRecord(sql, OWNER.daniel);
      const rows = await sql`select id from records where id = ${NEW.record}`;
      return rows.length;
    });

    expect(seen).toBe(1);
  });
});

describe("documents and their files", () => {
  test("a document may be added to a record you can see", async () => {
    const error = await asUserRollingBack(USER.daniel, (sql) =>
      refusal(() => insertDocument(sql, RECORD.danielLicence)),
    );

    expect(error).toBeNull();
  });

  test("a document may not be added to a record you cannot see", async () => {
    // Ivy's counselling letter is private to Ivy (D17). Her mother cannot add
    // a page to a record she is not allowed to know exists.
    const error = await asUserRollingBack(USER.maya, (sql) =>
      refusal(() => insertDocument(sql, RECORD.ivyCounselling)),
    );

    expect(error?.code).toBe("42501");
  });

  test("a file may be attached to a document you can see", async () => {
    const error = await asUserRollingBack(USER.daniel, (sql) =>
      refusal(() => insertFile(sql, DOCUMENT.danielLicence)),
    );

    expect(error).toBeNull();
  });

  test("a file may not be attached to a document you cannot see", async () => {
    const error = await asUserRollingBack(USER.sam, (sql) =>
      refusal(() => insertFile(sql, DOCUMENT.mayaPassport)),
    );

    expect(error?.code).toBe("42501");
  });

  test("a third party may not attach a file to a document they can see", async () => {
    const error = await asUserRollingBack(USER.sam, (sql) =>
      refusal(() => insertFile(sql, DOCUMENT.halePermit)),
    );

    expect(error?.code).toBe("42501");
  });
});

describe("what stays out of reach entirely", () => {
  const forbidden = [
    ["owners", (sql: Sql) => sql`insert into owners (kind, display_name) values ('person', 'Invented')`],
    ["users", (sql: Sql) => sql`insert into users (email, name, role) values ('x@example.invalid', 'X', 'admin')`],
    ["grant_owners", (sql: Sql) => sql`insert into grant_owners (user_id, owner_id) values (${USER.sam}, ${OWNER.rose})`],
    ["grant_categories", (sql: Sql) => sql`insert into grant_categories (user_id, category) values (${USER.sam}, 'medical')`],
    ["grant_records", (sql: Sql) => sql`insert into grant_records (user_id, record_id) values (${USER.sam}, ${RECORD.mayaPassport})`],
    ["emergency_activations", (sql: Sql) => sql`insert into emergency_activations (user_id, expires_at) values (${USER.lapsed}, now() + interval '1 day')`],
    ["relationships", (sql: Sql) => sql`insert into relationships (from_owner_id, to_owner_id, kind) values (${OWNER.sam ?? OWNER.rose}, ${OWNER.nadia}, 'spouse_of')`],
  ] as const;

  test.each(forbidden)(
    "even an admin cannot write %s through the application",
    async (_table, write) => {
      // Granting access, inventing a person, or opening an emergency window are
      // all writes the application has no business making yet. When each of
      // those surfaces exists it gets its own policy and its own test — until
      // then the role has no grant, which fails louder than a policy would.
      const error = await asUserRollingBack(USER.priya, (sql) =>
        refusal(() => write(sql)),
      );

      expect(error?.code).toBe("42501");
    },
  );

  test("nothing already in the vault can be changed", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(
        () => sql`update records set title = 'renamed' where id = ${RECORD.mayaPassport}`,
      ),
    );

    expect(error?.code).toBe("42501");
  });

  test("nothing already in the vault can be deleted", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => sql`delete from documents where id = ${DOCUMENT.mayaPassport}`),
    );

    expect(error?.code).toBe("42501");
  });
});
