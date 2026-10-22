import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Browser, detectBrowserPlatform, install } from "@puppeteer/browsers";
import type { TestProject } from "vitest/node";
import { fineGrainedToken, githubTokenSource } from "./helpers/tokens";

/**
 * Chrome for Testing build used by the suite. Branded Google Chrome ignores --load-extension, Chrome for Testing does not.
 * Bump deliberately: the build is downloaded once per version into .cache/chrome and reused afterwards.
 */
export const CHROME_BUILD_ID = "156.0.8078.47";

const root = resolve(import.meta.dirname, "../..");
const cacheDir = resolve(root, ".cache/chrome");
const extensionDir = resolve(root, "dist");

export default async function setup(project: TestProject): Promise<void> {
  // `bun run test:e2e` builds first; this only guards against running vitest directly on a missing or empty dist/.
  if (!existsSync(resolve(extensionDir, "manifest.json"))) {
    throw new Error(`No built extension at ${extensionDir}. Run \`bun run test:e2e\` (it builds first) or \`bun run build\`.`);
  }

  // Screenshots of failing tests (see ExtensionSession.afterTest); drop the ones from earlier runs.
  await rm(resolve(root, ".cache/e2e-failures"), { recursive: true, force: true });

  const platform = detectBrowserPlatform();
  if (!platform)
    throw new Error(`@puppeteer/browsers cannot detect a Chrome for Testing platform for ${process.platform}/${process.arch}.`);

  let lastLoggedStep = -1;
  const { executablePath } = await install({
    browser: Browser.CHROME,
    buildId: CHROME_BUILD_ID,
    cacheDir,
    platform,
    // No-op when the build is already in the cache.
    downloadProgressCallback: (downloaded, total) => {
      const step = Math.floor((downloaded / total) * 10);
      if (step === lastLoggedStep) return;
      lastLoggedStep = step;
      console.log(`[e2e] downloading Chrome for Testing ${CHROME_BUILD_ID} (${platform}): ${step * 10}%`);
    },
  });

  const main = githubTokenSource();
  console.log(`[e2e] Chrome for Testing ${CHROME_BUILD_ID} (${platform}), extension ${extensionDir}`);
  console.log(
    `[e2e] GitHub token: ${main ? main.source : "not available, token-dependent files are skipped (set GITHUB_TOKEN or log in with `gh auth login`)"}`,
  );
  console.log(
    `[e2e] fine-grained token: ${fineGrainedToken() ? "GITHUB_FINE_GRAINED_TOKEN" : "not set, fine-grained scenario is skipped"}`,
  );

  project.provide("chromeExecutable", executablePath);
  project.provide("extensionDir", extensionDir);
}
