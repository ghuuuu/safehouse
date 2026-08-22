import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    // The permission tests run against real Postgres. It is rebuilt from the
    // migrations and the fixture once per run, here, before anything loads.
    globalSetup: ["app/db/global-setup.ts"],
  },
});
