/**
 * Handing bytes back, and the three gates in front of them.
 *
 * `withVault` decides there is a session, `requireStepUp` decides it is still
 * the same person, and the policies decide whether the row exists. These are
 * the assertions that the third gate is the database's and not this code's,
 * and that the second one cannot be walked past.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { downloadName } from "./download.server";
import type { SignedInUser } from "./session.server";
import {
  clearStepUp,
  grantStepUp,
  requireStepUp,
  STEP_UP_SECONDS,
  stepUpRemaining,
} from "./stepup.server";

const USER: SignedInUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "someone@example.invalid",
  name: "Someone",
  role: "individual",
  personOwnerId: null,
};

const OTHER: SignedInUser = { ...USER, id: "22222222-2222-4222-8222-222222222222" };

/** A request carrying whatever Set-Cookie value was handed out. */
function carrying(setCookie: string, url = "http://localhost:4021/file/abc") {
  return new Request(url, {
    headers: { cookie: setCookie.split(";")[0] },
  });
}

beforeAll(async () => {
  // stepup.server reads the signing secret at import; the suite's .env has one.
  const dir = await mkdtemp(join(tmpdir(), "safehouse-dl-"));
  await writeFile(join(dir, "key"), randomBytes(32).toString("hex"));
});

afterAll(() => {});

describe("the step-up window", () => {
  test("a fresh grant is good for the full window", async () => {
    const request = carrying(await grantStepUp(USER));

    expect(await stepUpRemaining(request, USER)).toBeGreaterThan(
      STEP_UP_SECONDS - 5,
    );
  });

  test("no cookie is no window", async () => {
    const request = new Request("http://localhost:4021/file/abc");

    expect(await stepUpRemaining(request, USER)).toBe(0);
  });

  test("it expires", async () => {
    const granted = await grantStepUp(USER, Date.now() - (STEP_UP_SECONDS + 1) * 1000);

    expect(await stepUpRemaining(carrying(granted), USER)).toBe(0);
  });

  test("it belongs to one account, not to the browser", async () => {
    // Signing out and in as somebody else must not inherit the window.
    const granted = await grantStepUp(USER);

    expect(await stepUpRemaining(carrying(granted), OTHER)).toBe(0);
  });

  test("a cookie dated in the future is not a longer window", async () => {
    const granted = await grantStepUp(USER, Date.now() + 60 * 60 * 1000);

    expect(await stepUpRemaining(carrying(granted), USER)).toBe(0);
  });

  test("a forged cookie is not a window", async () => {
    // Unsigned, hand-written, exactly the shape the real one decodes to.
    const forged = `safehouse_stepup=${Buffer.from(
      JSON.stringify({ userId: USER.id, at: Date.now() }),
    ).toString("base64")}`;

    const request = new Request("http://localhost:4021/file/abc", {
      headers: { cookie: forged },
    });

    expect(await stepUpRemaining(request, USER)).toBe(0);
  });

  test("clearing it ends the window", async () => {
    const cleared = await clearStepUp();

    expect(await stepUpRemaining(carrying(cleared), USER)).toBe(0);
  });
});

describe("requiring it", () => {
  test("passes silently when the window is open", async () => {
    const request = carrying(await grantStepUp(USER));

    await expect(requireStepUp(request, USER)).resolves.toBeUndefined();
  });

  test("throws a redirect to the password form, keeping the destination", async () => {
    const request = new Request("http://localhost:4021/file/the-id?page=2");

    const thrown = await requireStepUp(request, USER).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("location")).toBe(
      "/verify?next=%2Ffile%2Fthe-id%3Fpage%3D2",
    );
  });

  test("throws rather than returns, so a caller that ignores it still stops", async () => {
    // The shape of the mistake this prevents: `requireStepUp(...)` called
    // without await-ing a verdict, then the bytes served anyway.
    const request = new Request("http://localhost:4021/file/abc");

    await expect(requireStepUp(request, USER)).rejects.toBeInstanceOf(Response);
  });
});

describe("the name the browser is given", () => {
  const row = {
    id: "x",
    mime: "application/pdf",
    byteSize: 1,
    sha256: "x",
    pageNo: 1,
    title: "Passport",
  };

  test("comes from the record's title, with the right extension", () => {
    expect(downloadName(row)).toBe("Passport.pdf");
    expect(downloadName({ ...row, mime: "image/jpeg" })).toBe("Passport.jpg");
  });

  test("numbers the pages of a multi-page document", () => {
    expect(downloadName({ ...row, pageNo: 2 })).toBe("Passport-2.pdf");
  });

  test("strips anything that could escape a filename", () => {
    expect(downloadName({ ...row, title: "../../etc/passwd" })).toBe(
      "etcpasswd.pdf",
    );
    expect(downloadName({ ...row, title: 'a"b;c' })).toBe("abc.pdf");
  });

  test("falls back rather than producing a nameless file", () => {
    expect(downloadName({ ...row, title: "///" })).toBe("document.pdf");
  });

  test("keeps letters that are not ASCII", () => {
    expect(downloadName({ ...row, title: "Carte d'identité" })).toBe(
      "Carte didentité.pdf",
    );
  });
});
