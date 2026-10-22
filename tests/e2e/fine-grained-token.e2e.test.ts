/**
 * A fine-grained token without "Contents: Read and write" cannot list stargazers. Everything else must still load,
 * and the feed must say why stars are missing (README, "Token").
 *
 * Runs only when GITHUB_FINE_GRAINED_TOKEN holds such a token (Metadata, Issues, Pull requests and Contents read-only).
 */
import type { Page } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Kind } from "../../src/lib/types";
import {
  count,
  fineGrainedToken,
  goToFeed,
  goToSettings,
  launchExtension,
  storeToken,
  waitForFullSweep,
  type ExtensionSession,
  type LocalStorage,
  type RefreshStatus,
} from "./helpers/browser";

const token = fineGrainedToken();

describe.skipIf(!token)("fine-grained token without stargazer access (needs GITHUB_FINE_GRAINED_TOKEN)", () => {
  let ext: ExtensionSession;
  let page: Page;
  let status: RefreshStatus;

  beforeAll(async () => {
    ext = await launchExtension();
    page = await ext.openPage();
    await storeToken(page, token!);
    status = await waitForFullSweep(page, 240_000);
  });
  afterAll(async () => {
    await ext?.close();
  });
  afterEach(async ({ task }) => {
    await ext.afterTest(task);
  });

  it("is accepted, but the probe finds that stargazers are unreadable", () => {
    expect(status.tokenOk, `token rejected: ${status.tokenError}`).toBe(true);
    expect(status.starsAccess).toBe(false);
  });

  it("loads repositories and events other than stars, without errors", async () => {
    const stored = await page.evaluate(async () => {
      const { events, ledger } = await chrome.storage.local.get<LocalStorage>(["events", "ledger"]);
      const kinds: Partial<Record<Kind, number>> = {};
      for (const e of Object.values(events ?? {})) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
      return { kinds, events: Object.keys(events ?? {}).length, repos: Object.keys(ledger ?? {}).length };
    });
    expect(stored.repos, "ledger entries").toBeGreaterThan(0);
    expect(stored.events, "cached events").toBeGreaterThan(0);
    expect(stored.kinds.star ?? 0, `star events (all kinds: ${JSON.stringify(stored.kinds)})`).toBe(0);
    expect(status.lastError ?? null, "the sweep reported an error").toBeNull();
  });

  it("shows the feed with a warning that stars are missing", async () => {
    await goToFeed(page);
    await page.waitForSelector("#col .row", { timeout: 15_000 });
    expect(await count(page, "#col .row"), "feed rows").toBeGreaterThan(0);
    expect(await page.$eval("#col .warnline", (el) => el.textContent)).toContain("Stars are missing");
  });

  it("explains in Settings which permission stars need", async () => {
    await goToSettings(page);
    const rows = await page.$$eval(".kv li", (lis) => lis.map((li) => li.textContent?.replace(/\s+/g, " ").trim()));
    expect(rows).toContainEqual(expect.stringMatching(/^Stars\s*Token cannot list stargazers\. .*Contents → Read and write/));
  });
});
