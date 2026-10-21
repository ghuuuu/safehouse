/**
 * Seal every identifier still sitting in the clear (D35).
 *
 *   npm run identifiers:seal      (npm run db:migrate runs it for you)
 *
 * 0013 added the sealed columns and stopped anything new being written in the
 * clear, but it could not encrypt what was already there: the key is not in
 * the database, on purpose. This is the half that needs the key. It runs as the
 * owner role, from the host, the same as a migration.
 *
 * One transaction. Either every number is sealed and the plain column is
 * empty, or nothing changed. Then the constraint is validated, which is
 * Postgres agreeing that no row anywhere holds a readable number.
 *
 * Safe to run any number of times. With nothing left to seal it needs no key.
 * It prints how many it sealed and never what.
 *
 * After `npm run restore` of a backup taken before D35, run this again.
 */

import "dotenv/config";

import postgres from "postgres";

import { identifierColumns } from "../app/field-crypto.server";
import { keyProviderFromFile } from "../app/keys.server";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Missing DATABASE_URL. See .env.example.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const sealed = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string; identifier: string }[]>`
      select id, identifier from documents where identifier is not null for update
    `;
    if (rows.length === 0) return 0;

    const keyFile = process.env.SAFEHOUSE_KEY_FILE;
    if (!keyFile) {
      throw new Error(
        `${rows.length} identifier(s) are still readable and need the key to seal. Set SAFEHOUSE_KEY_FILE.`,
      );
    }
    const provider = keyProviderFromFile(keyFile);

    for (const row of rows) {
      const columns = identifierColumns(row.identifier, row.id, provider);
      await tx`
        update documents
        set identifier = null, identifier_sealed = ${columns.sealed},
            identifier_fp = ${columns.fp}, identifier_last4_fp = ${columns.last4}
        where id = ${row.id}
      `;
    }
    return rows.length;
  });

  await sql`alter table documents validate constraint identifier_is_sealed`;

  // What the reader proposed is stored beside each document and draft. Before
  // 2026-10-20 a proposed policy number kept a note that quoted it ("printed
  // as ..."), so the number sat there in the clear. The app no longer writes
  // or sends one (`sealedProposal`); this empties the ones already stored. No
  // key needed: nothing is sealed, the copies just go.
  // Constant SQL only: the table, column and path below are fixed strings.
  const scrub = (table: string, column: string, path: string[]) => {
    const at = `${column}->'${path.join("'->'")}'`;
    return `
      update ${table} set ${column} = jsonb_set(${column}, '{${path.join(",")}}', (
        select coalesce(jsonb_agg(
          case when p->>'field' = 'identifier' then (p - 'value' - 'note') || '{"masked": true}'::jsonb else p end
          order by n), '[]'::jsonb)
        from jsonb_array_elements(${at}) with ordinality as e(p, n)))
      where jsonb_typeof(${at}) = 'array'
        and exists (select 1 from jsonb_array_elements(${at}) p
                    where p->>'field' = 'identifier' and (p ? 'note' or p ? 'value'))
    `;
  };
  const scrubbed = await sql.begin(async (tx) => {
    const documents = await tx.unsafe(scrub("documents", "extraction", ["proposals"]));
    const drafts = await tx.unsafe(scrub("intakes", "fields", ["terms", "proposals"]));
    return documents.count + drafts.count;
  });

  console.log(
    sealed === 0
      ? "Identifiers: none readable in the database."
      : `Identifiers: sealed ${sealed}. None readable in the database.`,
  );
  if (scrubbed > 0) console.log(`Identifiers: removed the reader's copy from ${scrubbed} stored read(s).`);
} catch (error) {
  console.error(`Sealing identifiers failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
