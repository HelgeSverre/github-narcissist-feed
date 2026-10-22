import { defineConfig } from "vitest/config";

/**
 * End-to-end suite: the built extension (dist/) in a real Chrome for Testing, driven through puppeteer-core.
 * Run with `npm run test:e2e`, which builds first (`vite build && vitest run --config vitest.e2e.config.ts`).
 * Kept apart from vitest.config.ts so `npm test` stays fast, offline and browser-free.
 *
 * Chrome for Testing is installed into .cache/chrome by tests/e2e/global-setup.ts. Token-dependent files use
 * GITHUB_TOKEN or `gh auth token`; the fine-grained scenario needs GITHUB_FINE_GRAINED_TOKEN. Missing tokens skip, never fail.
 */
export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    globalSetup: ["tests/e2e/global-setup.ts"],
    // One real Chrome at a time: a single worker, files run in sequence, each file launches its own browser and profile.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    // A full GitHub sweep takes about 30 s, longer on a slow connection.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    reporters: ["verbose"],
  },
});
