/**
 * Builds the test database once, before any test file runs.
 *
 * Test files run in separate workers with separate module registries, so a
 * per-file guard cannot stop two of them rebuilding the same database at the
 * same time. This can, and vitest calls it exactly once.
 */

import { buildTestDatabase } from "./test-harness";

export default async function setup(): Promise<void> {
  await buildTestDatabase();
}
