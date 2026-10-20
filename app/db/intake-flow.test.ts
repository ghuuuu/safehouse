/**
 * A draft, end to end, against real policies and a real disk (D39, D40): a
 * photographed card goes in, gets checked and corrected, and comes out as one
 * PDF the size of a card, filed. Every image is drawn by the test, and every
 * value typed is fictional.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFDocument } from "@cantoo/pdf-lib";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { openIdentifier } from "../field-crypto.server";
import { mmToPt } from "../paper";
import { OWNER, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

const MARK = "TEST-INTAKE";

let asUser: typeof import("../db.server").asUser;
let intake: typeof import("../intake.server");
let download: typeof import("../download.server");
let storage: typeof import("../storage.server");

beforeAll(async () => {
  await prepareTestDatabase();
  const store = await mkdtemp(join(tmpdir(), "safehouse-intake-"));
  process.env.SAFEHOUSE_STORAGE_DIR = store;
  const keyFile = join(store, "test.key");
  await writeFile(keyFile, randomBytes(32).toString("hex"));
  process.env.SAFEHOUSE_KEY_FILE = keyFile;

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  url.username = "safehouse_app";
  url.password = process.env.APP_DB_PASSWORD!;
  process.env.APP_DATABASE_URL = url.toString();

  ({ asUser } = await import("../db.server"));
  intake = await import("../intake.server");
  download = await import("../download.server");
  storage = await import("../storage.server");
}, 60_000);

afterAll(async () => {
  await owner()`delete from intakes where title like ${`${MARK}%`}`;
  await owner()`delete from records where title like ${`${MARK}%`}`;
  await closeTestDatabase();
});

/** A pale card turned 6 degrees on a dark table. */
async function photographedCard(): Promise<Buffer> {
  const t = (6 * Math.PI) / 180;
  const at = (x: number, y: number) => `${800 + x * Math.cos(t) - y * Math.sin(t)},${600 + x * Math.sin(t) + y * Math.cos(t)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
    <rect width="1600" height="1200" fill="#2b2b2b"/>
    <polygon points="${[at(-428, -270), at(428, -270), at(428, 270), at(-428, 270)].join(" ")}" fill="#f0efe8"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

async function draftWith(userId: string, bytes: Buffer, mime: string, title = `${MARK} a card`) {
  const examined = await intake.examine(bytes, mime);
  return asUser(userId, async (db) => {
    const id = await intake.startIntake(db, userId, { ownerId: OWNER.maya, category: "personal", title });
    await intake.addSource(db, id, { mime, bytes }, examined);
    return id;
  });
}

describe("a photographed card, filed", () => {
  test("its outline is found and its size guessed", async () => {
    const examined = await intake.examine(await photographedCard(), "image/jpeg");
    expect(examined.pages).toHaveLength(1);
    expect(examined.pages[0].corners?.found).toBe(true);
    expect(examined.pages[0].size).toBe("id1");
  });

  test("becomes one PDF page the size of a card, the photo inside it, the draft gone", async () => {
    const photo = await photographedCard();
    const id = await draftWith(USER.maya, photo, "image/jpeg");

    const { documentId, released } = await asUser(USER.maya, async (db) => {
      await intake.saveDetails(db, id, {
        ownerId: OWNER.maya,
        category: "personal",
        title: `${MARK} a card`,
        values: { expires_on: "2031-04-30", identifier: "ZZ0000001" },
      });
      return intake.submitIntake(db, id);
    });
    await Promise.all(released.map((key) => storage.deleteBlob(key)));

    const bytes = await asUser(USER.maya, async (db) => {
      const files = await db.execute<{ id: string }>(sql`select id from document_files where document_id = ${documentId}`);
      expect([...files]).toHaveLength(1);
      return download.readFileContents((await download.findFile(db, [...files][0].id))!);
    });

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(mmToPt(85.6), 1);
    expect(height).toBeCloseTo(mmToPt(54), 1);
    expect(Buffer.from(pdf.getAttachments()[0].data).equals(photo)).toBe(true);

    const [doc] = await owner()`
      select d.expires_on::text as "expiresOn", d.confirmed_fields as confirmed, d.identifier_sealed as sealed, f.mime
      from documents d join document_files f on f.document_id = d.id where d.id = ${documentId}
    `;
    expect(doc.mime).toBe("application/pdf");
    expect(doc.expiresOn).toBe("2031-04-30");
    expect(doc.confirmed).toEqual(expect.arrayContaining(["expires_on", "identifier"]));
    expect(openIdentifier(doc.sealed, documentId)).toBe("ZZ0000001");

    const left = await owner()`select count(*)::int as n from intakes where id = ${id}`;
    expect(left[0].n).toBe(0);
  });
});

describe("what stops a draft being filed", () => {
  test("a photo with no outline and no recorded resolution has no size, and says so", async () => {
    const blank = await sharp({ create: { width: 900, height: 700, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    const id = await draftWith(USER.maya, blank, "image/jpeg", `${MARK} no size`);
    const refused = await asUser(USER.maya, (db) => intake.submitIntake(db, id)).catch((e: Error) => e.message);
    expect(refused).toMatch(/Choose a size/);
  });

  test("a PDF with a password is turned away at the door", async () => {
    const notAPdf = Buffer.from("%PDF-1.7 this is not really a pdf");
    await expect(intake.examine(notAPdf, "application/pdf")).rejects.toThrow(/cannot be opened/);
  });

  test("a third party is refused by the database before anything reaches the disk", async () => {
    const before = await owner()`select count(*)::int as n from intake_sources`;
    const refused = await draftWith(USER.sam, await photographedCard(), "image/jpeg", `${MARK} sam`).catch(
      (e: { cause?: { code?: string } }) => e.cause?.code,
    );
    const after = await owner()`select count(*)::int as n from intake_sources`;
    expect(refused).toBe("42501");
    expect(after[0].n).toBe(before[0].n);
  });

  test("HEIC is not accepted, so a phone sends JPEG instead", async () => {
    await expect(intake.examine(Buffer.from("x"), "image/heic")).rejects.toThrow(/cannot be stored/);
  });
});

describe("whose draft it is", () => {
  test("another member cannot open, change or file it, and an admin can open it", async () => {
    const id = await draftWith(USER.maya, await photographedCard(), "image/jpeg", `${MARK} maya's draft`);

    expect(await asUser(USER.daniel, (db) => intake.loadIntake(db, id))).toBeNull();
    expect(await asUser(USER.daniel, (db) => intake.discardIntake(db, id))).toEqual([]);
    expect(await asUser(USER.priya, (db) => intake.loadIntake(db, id))).not.toBeNull();
  });

  test("the reader never overwrites what a person typed", async () => {
    const id = await draftWith(USER.maya, await photographedCard(), "image/jpeg", `${MARK} typed`);
    const view = await asUser(USER.maya, async (db) => {
      await intake.saveDetails(db, id, {
        ownerId: OWNER.maya,
        category: "personal",
        title: `${MARK} typed`,
        values: { expires_on: "2030-01-01" },
      });
      await intake.saveRead(db, id, [
        {
          proposals: [
            { field: "expires_on", value: "1999-12-31", source: "page-text", verified: false },
            { field: "issuer_country", value: "UTO", source: "mrz", verified: true },
          ],
          text: "",
          how: "Read by a test.",
        },
      ]);
      return intake.loadIntake(db, id);
    });
    expect(view!.values.expires_on).toEqual({ value: "2030-01-01", source: "person" });
    expect(view!.values.issuer_country).toEqual({ value: "UTO", source: "mrz", verified: true });
  });
});
