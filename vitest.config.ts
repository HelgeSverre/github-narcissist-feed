import { configDefaults, defineConfig } from "vitest/config";

// The date code reads the local clock and the system locale, so pin both: results must not depend on the machine.
// Set here (not in a test file) because worker processes inherit the environment, and ICU reads the locale once at start-up.
process.env.TZ = "Europe/Oslo";
process.env.LC_ALL = "en_US.UTF-8";

// Separate from vite.config.ts on purpose: the crx plugin needs a manifest and a browser build, tests do not.
// Unit tests are colocated with their source (src/**/*.test.ts); shared helpers live in tests/helpers.
// tests/e2e has its own config and is never picked up here.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["tests/helpers/setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
