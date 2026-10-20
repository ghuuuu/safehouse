/**
 * Who may see and change an import that is not finished yet (D40).
 *
 * Written before the migration that makes them pass. An intake is a draft: the
 * uploader's half-sorted pile, possibly a private paper not yet marked so. Its
 * uploader and the household's admins reach it; another member, a third party
 * and an emergency contact do not, and nothing in the vault's own lists can.
 *
 * Every transaction rolls back, so the fixture stays as it was.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { OWNER, USER } from "./fixture";
import {
  asUserRollingBack,
  closeTestDatabase,
  owner,
  prepareTestDatabase,
  refusal,
} from "./test-harness";

beforeAll(async () => {
  await prepareTestDatabase();
}, 60_000);

afterAll(async () => {
  await closeTestDatabase();
});

const INTAKE = "00000000-0000-4000-8000-000000000950";
const SOURCE = "00000000-0000-4000-8000-000000000951";
const PAGE = "00000000-0000-4000-8000-000000000952";

type Sql = Parameters<Parameters<typeof asUserRollingBack>[1]>[0];

function insertIntake(sql: Sql, createdBy: string, ownerId: string | null = OWNER.maya) {
  return sql`
    insert into intakes (id, created_by, owner_id, category, title)
    values (${INTAKE}, ${createdBy}, ${ownerId}, 'personal', 'Half-sorted')
  `;
}

function insertSource(sql: Sql) {
  const sealed = Buffer.from("sealed");
  return sql`
    insert into intake_sources (id, intake_id, storage_key, sha256, byte_size, mime, wrapped_dek, nonce)
    values (${SOURCE}, ${INTAKE}, 'test/intake-source', 'test-hash', 6, 'image/jpeg', ${sealed}, ${sealed})
  `;
}

function insertPage(sql: Sql) {
  return sql`
    insert into intake_pages (id, intake_id, source_id, source_page, position)
    values (${PAGE}, ${INTAKE}, ${SOURCE}, 0, 1)
  `;
}

/**
 * Maya's intake, made as the owner so the fixture holds one, then read by
 * somebody else inside the same rolled-back transaction.
 */
async function seeingMayasIntake(viewer: string) {
  return asUserRollingBack(viewer, async (sql) => {
    await owner()`
      insert into intakes (id, created_by, owner_id, category, title)
      values (${INTAKE}, ${USER.maya}, ${OWNER.maya}, 'personal', 'Half-sorted')
    `;
    try {
      const rows = await sql`select id from intakes where id = ${INTAKE}`;
      const pages = await sql`select id from intake_pages where intake_id = ${INTAKE}`;
      return { intakes: rows.length, pages: pages.length };
    } finally {
      await owner()`delete from intakes where id = ${INTAKE}`;
    }
  });
}

describe("making an intake", () => {
  test("an individual may start one of their own", async () => {
    const error = await asUserRollingBack(USER.maya, (sql) => refusal(() => insertIntake(sql, USER.maya)));
    expect(error).toBeNull();
  });

  test("nobody may start one in somebody else's name", async () => {
    const error = await asUserRollingBack(USER.maya, (sql) => refusal(() => insertIntake(sql, USER.daniel)));
    expect(error?.code).toBe("42501");
  });

  test("an admin may start one", async () => {
    const error = await asUserRollingBack(USER.priya, (sql) =>
      refusal(() => insertIntake(sql, USER.priya, OWNER.nadia)),
    );
    expect(error).toBeNull();
  });

  test("a third party may not, being somebody who reads and does not file", async () => {
    const error = await asUserRollingBack(USER.sam, (sql) => refusal(() => insertIntake(sql, USER.sam, null)));
    expect(error?.code).toBe("42501");
  });

  test("an emergency contact may not", async () => {
    const error = await asUserRollingBack(USER.medic, (sql) => refusal(() => insertIntake(sql, USER.medic, null)));
    expect(error?.code).toBe("42501");
  });

  test("not for an owner the filer cannot see", async () => {
    const error = await asUserRollingBack(USER.maya, (sql) =>
      refusal(() => insertIntake(sql, USER.maya, OWNER.nadia)),
    );
    expect(error?.code).toBe("42501");
  });

  test("its sources and pages go with it", async () => {
    const error = await asUserRollingBack(USER.maya, async (sql) => {
      await insertIntake(sql, USER.maya);
      return refusal(async () => {
        await insertSource(sql);
        await insertPage(sql);
      });
    });
    expect(error).toBeNull();
  });
});

describe("seeing an intake", () => {
  test("its uploader sees it", async () => {
    expect((await seeingMayasIntake(USER.maya)).intakes).toBe(1);
  });

  test("an admin sees it", async () => {
    expect((await seeingMayasIntake(USER.priya)).intakes).toBe(1);
  });

  test("another member of the household does not", async () => {
    expect((await seeingMayasIntake(USER.daniel)).intakes).toBe(0);
  });

  test("a third party does not", async () => {
    expect((await seeingMayasIntake(USER.sam)).intakes).toBe(0);
  });

  test("an emergency contact with a window open does not", async () => {
    expect((await seeingMayasIntake(USER.medic)).intakes).toBe(0);
  });
});

describe("changing an intake", () => {
  test("another member can neither edit nor discard it", async () => {
    const result = await asUserRollingBack(USER.daniel, async (sql) => {
      await owner()`
        insert into intakes (id, created_by, owner_id, category, title)
        values (${INTAKE}, ${USER.maya}, ${OWNER.maya}, 'personal', 'Half-sorted')
      `;
      try {
        const edited = await sql`update intakes set title = 'Mine now' where id = ${INTAKE} returning id`;
        const gone = await sql`delete from intakes where id = ${INTAKE} returning id`;
        return { edited: edited.length, gone: gone.length };
      } finally {
        await owner()`delete from intakes where id = ${INTAKE}`;
      }
    });
    expect(result).toEqual({ edited: 0, gone: 0 });
  });

  test("its uploader may discard it", async () => {
    const gone = await asUserRollingBack(USER.maya, async (sql) => {
      await insertIntake(sql, USER.maya);
      return (await sql`delete from intakes where id = ${INTAKE} returning id`).length;
    });
    expect(gone).toBe(1);
  });

  test("an edit cannot hand it to somebody else", async () => {
    const error = await asUserRollingBack(USER.maya, async (sql) => {
      await insertIntake(sql, USER.maya);
      return refusal(() => sql`update intakes set created_by = ${USER.daniel} where id = ${INTAKE}`);
    });
    expect(error?.code).toBe("42501");
  });

  test("an edit cannot point it at an owner out of reach", async () => {
    const error = await asUserRollingBack(USER.maya, async (sql) => {
      await insertIntake(sql, USER.maya);
      return refusal(() => sql`update intakes set owner_id = ${OWNER.nadia} where id = ${INTAKE}`);
    });
    expect(error?.code).toBe("42501");
  });
});

describe("the vault never sees a draft", () => {
  test("the app may still not delete or update anything in the vault", async () => {
    const offenders = await owner()`
      select c.relname, p.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral (values ('UPDATE'), ('DELETE')) as p(privilege_type)
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname in ('records', 'document_files')
        and has_table_privilege('safehouse_app', c.oid, p.privilege_type)
    `;
    expect(offenders).toEqual([]);
  });
});
