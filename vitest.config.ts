import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    // The permission tests run against real Postgres. It is rebuilt from the
    // migrations and the fixture once per run, here, before anything loads.
    globalSetup: ["app/db/global-setup.ts"],
    // One database, shared by every test file, and some of these tests have to
    // change a row to prove anything — demoting an admin mid-session, for one.
    // Run the files one at a time so a mutation cannot be read by a file that
    // is asserting on the fixture as written. The whole suite takes seconds;
    // the alternative is a race that fails one run in twenty.
    fileParallelism: false,
  },
});
