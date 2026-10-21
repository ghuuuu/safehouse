/**
 * Delivery beyond the app (Step 17, D13, D37), against a real webhook.
 *
 * A local HTTP server stands in for ntfy. What these pin down: every message
 * is a sentence with no title, name or value in it; a reminder goes out once;
 * a failure is recorded on its row rather than lost; and nothing is written
 * for anybody but the admins.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { DOCUMENT, USER } from "./fixture";
import { closeTestDatabase, owner, prepareTestDatabase } from "./test-harness";

let notify: typeof import("../notify.server");
let server: Server;
let url = "";
let received: string[] = [];
let status = 200;

beforeAll(async () => {
  await prepareTestDatabase();

  const base = new URL(process.env.DATABASE_URL!);
  base.pathname = `/${process.env.TEST_DATABASE_NAME ?? "safehouse_test"}`;
  for (const [env, role, password] of [
    ["APP_DATABASE_URL", "safehouse_app", process.env.APP_DB_PASSWORD!],
    ["AUTH_DATABASE_URL", "safehouse_auth", process.env.AUTH_DB_PASSWORD!],
  ] as const) {
    const u = new URL(base);
    u.username = role;
    u.password = password;
    process.env[env] = u.toString();
  }

  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.url === "/slow") return; // never answers
      received.push(body);
      res.statusCode = status;
      res.end("a body that could say anything, including FIXTURE-PP-0001");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  notify = await import("../notify.server");
}, 60_000);

afterAll(async () => {
  await owner()`delete from notifications where kind = 'expiry.soon' and user_id = ${USER.priya}`;
  await owner()`update notifications set delivered_at = null, delivery_attempts = 0, delivery_error = null`;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await closeTestDatabase();
});

beforeEach(async () => {
  received = [];
  status = 200;
  await owner()`delete from notifications where kind = 'expiry.soon'`;
  await owner()`update notifications set delivered_at = null, delivery_attempts = 0, delivery_error = null`;
});

const admins = async () => [USER.priya];
const rows = () => owner()`
  select user_id, kind, delivered_at, delivery_attempts, delivery_error from notifications order by created_at
`;

describe("a sweep", () => {
  test("writes one reminder per expiring document, for the admin only", async () => {
    const result = await notify.sweep(null, admins);
    const all = await rows();
    const reminders = all.filter((r) => r.kind === "expiry.soon");

    expect(result.written).toBe(4);
    expect(reminders.every((r) => r.user_id === USER.priya)).toBe(true);
    // Nothing was configured, so nothing was attempted.
    expect(all.every((r) => r.delivery_attempts === 0)).toBe(true);
  });

  test("a second sweep writes nothing new", async () => {
    await notify.sweep(null, admins);
    expect((await notify.sweep(null, admins)).written).toBe(0);
  });

  test("delivers every undelivered row once, and says nothing a stranger could use", async () => {
    const send = notify.webhookSender(url)!;
    const first = await notify.sweep(send, admins);
    const second = await notify.sweep(send, admins);

    expect(first.failed).toBe(0);
    expect(second.sent).toBe(0);
    expect(received.length).toBe(first.sent);
    expect(received.some((m) => /a document expires in \d+ days/.test(m))).toBe(true);
    expect(received.some((m) => m.includes("emergency contact has opened the vault"))).toBe(true);

    const everything = received.join("\n");
    for (const forbidden of ["Passport", "Rose", "Daniel", "Hale", "insurance", "FIXTURE", "Medic", "Emergency Contact"]) {
      expect(everything).not.toContain(forbidden);
    }
  });
});

describe("stages", () => {
  const stagesOf = async (documentId: string) =>
    (await owner()`
      select stage from notifications where kind = 'expiry.soon' and subject_id = ${documentId} order by created_at
    `).map((r) => r.stage);

  /** Moves Daniel's passport through the days given, sweeping twice on each. */
  const walk = async (days: number[]) => {
    const [{ was }] = await owner()`select expires_on::text as was from documents where id = ${DOCUMENT.danielPassport}`;
    try {
      for (const left of days) {
        await owner()`update documents set expires_on = current_date + ${left}::int where id = ${DOCUMENT.danielPassport}`;
        await notify.sweep(null, admins);
        await notify.sweep(null, admins);
      }
      return await stagesOf(DOCUMENT.danielPassport);
    } finally {
      await owner()`update documents set expires_on = ${was}::date where id = ${DOCUMENT.danielPassport}`;
    }
  };

  test("one each: entering the window, a week out, three days out, and on the day", async () => {
    expect(await walk([60, 30, 7, 5, 3, 1, 0, -2])).toEqual(["early", "week", "three", "today"]);
  });

  test("a paper first seen two days out is told of that, not of the stages it missed", async () => {
    expect(await walk([2, 1, 0])).toEqual(["three", "today"]);
  });
});

describe("two deliveries at once", () => {
  test("send each message once, not once each", async () => {
    // A break-glass delivers straight away (deliverNow) while the sweep may be
    // part-way through the same rows. Both read them as undelivered.
    await notify.sweep(null, admins);
    const pending = (await rows()).filter((r) => !r.delivered_at).length;
    const send = notify.webhookSender(url)!;

    await Promise.all([notify.deliverFor(USER.priya, send), notify.deliverFor(USER.priya, send)]);

    expect(pending).toBeGreaterThan(0);
    expect(received.length).toBe(pending);
  });
});

describe("a failure", () => {
  test("is recorded on the row, as a status and never the far end's body", async () => {
    status = 502;
    const result = await notify.sweep(notify.webhookSender(url)!, admins);
    const failed = (await rows()).filter((r) => r.delivery_error);

    expect(result.sent).toBe(0);
    expect(failed.length).toBe(result.failed);
    expect(failed.every((r) => r.delivery_error === "HTTP 502" && r.delivery_attempts === 1 && !r.delivered_at)).toBe(true);
  });

  test("a far end that never answers is recorded as timed out", async () => {
    const result = await notify.sweep(notify.webhookSender(`${url}/slow`, 200)!, admins);
    const failed = (await rows()).filter((r) => r.delivery_error);
    expect(result.failed).toBeGreaterThan(0);
    expect(new Set(failed.map((r) => r.delivery_error))).toEqual(new Set(["timed out"]));
  });

  test("is retried, and stops after five", async () => {
    status = 500;
    const send = notify.webhookSender(url)!;
    for (let i = 0; i < 7; i++) await notify.sweep(send, admins);
    const attempts = (await rows()).map((r) => r.delivery_attempts);
    expect(Math.max(...attempts)).toBe(5);
  });

  test("an unreachable channel is recorded without its address", async () => {
    await notify.sweep(notify.webhookSender("http://127.0.0.1:1/secret-topic-name")!, admins);
    const errors = (await rows()).map((r) => r.delivery_error).filter(Boolean);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).not.toContain("secret-topic-name");
  });
});

test("the real admin list comes from the auth connection: Priya, and nobody disabled", async () => {
  const { activeAdminIds } = await import("../auth.server");
  expect(await activeAdminIds()).toEqual([USER.priya]);
});
