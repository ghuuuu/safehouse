import { describe, expect, it } from "vitest";

import { checkDatabase } from "./db.server";

describe("checkDatabase", () => {
  it("reports ok when the query succeeds", async () => {
    await expect(checkDatabase(async () => [{ "?column?": 1 }])).resolves.toEqual({
      ok: true,
    });
  });

  it("reports the failure instead of throwing", async () => {
    const status = await checkDatabase(async () => {
      throw new Error("connection refused");
    });

    expect(status).toEqual({ ok: false, error: "connection refused" });
  });
});
