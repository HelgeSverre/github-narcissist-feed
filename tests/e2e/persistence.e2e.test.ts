/**
 * docs/specs/persistence-and-sync.md, "Verification": change filters and layout, reload and assert they persisted;
 * write `view` to chrome.storage.sync from the service worker to play "another computer" and assert the open page
 * follows without a reload; a second tab sees the same state; Reset filters in Settings > Sync.
 *
 * The groups below run in order against one profile and one open tab. Needs GITHUB_TOKEN or an authenticated `gh` CLI,
 * because the rail needs real repositories and events to filter.
 */
import type { Page } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  chooseGroup,
  chooseRailPeriod,
  clickRailRow,
  clickResetFilters,
  expectRail,
  githubToken,
  goToFeed,
  goToSettings,
  launchExtension,
  pickFirstRepository,
  storeToken,
  toggleRailSection,
  waitForEvents,
  type ExtensionSession,
  type SyncStorage,
} from "./helpers/browser";

const ALL_KINDS = ["star", "fork", "issue", "pr", "comment", "review", "release"];
const RETIRED_SETTINGS = ["defaultPeriod", "defaultGroup", "showOwn", "showBots"];

const token = githubToken();

describe.skipIf(!token)("persistence and sync (needs GITHUB_TOKEN or an authenticated `gh` CLI)", () => {
  let ext: ExtensionSession;
  let page: Page;
  let repo: string;

  beforeAll(async () => {
    ext = await launchExtension();
    page = await ext.openPage();
    await storeToken(page, token!);
    // The first batches of the sweep are enough: the rail only needs some repositories and events.
    await waitForEvents(page, 50);
    await goToFeed(page);
    await page.waitForSelector("#col .row", { timeout: 20_000 });
  });
  afterAll(async () => {
    await ext?.close();
  });
  afterEach(async ({ task }) => {
    await ext.afterTest(task);
  });

  it("starts from the defaults", async () => {
    await expectRail(page, {
      kinds: { Stars: true, Forks: true, Issues: true },
      hideMe: false,
      hideBots: false,
      period: "30",
      group: "Day",
      reposChecked: [],
      closedSections: [],
    });
    expect((await ext.syncStorage()).view, "nothing has been changed, so nothing is written").toBeUndefined();
  });

  describe("after changing filters and layout", () => {
    beforeAll(async () => {
      repo = await pickFirstRepository(page);
      await clickRailRow(page, "activity", "Issues");
      await clickRailRow(page, "people", "Hide bots");
      await chooseRailPeriod(page, "7");
      await chooseGroup(page, "Week");
      await toggleRailSection(page, "owners");
      // Writes are debounced per key; wait until the last change to each of view and layout has reached chrome.storage.sync.
      await vi.waitFor(
        async () => {
          const sync = await ext.syncStorage();
          expect(sync.view).toMatchObject({ period: "7", group: "week", hideBots: true });
          expect(sync.layout?.railClosed).toEqual(["owners"]);
        },
        { timeout: 10_000, interval: 100 },
      );
    });

    it("writes the view to chrome.storage.sync", async () => {
      const sync = await ext.syncStorage();
      expect(sync.schema).toBe(2);
      expect(sync.view).toEqual({
        period: "7",
        group: "week",
        kinds: ALL_KINDS.filter((k) => k !== "issue"),
        hideMe: false,
        hideBots: true,
        repos: [repo],
      });
    });

    it("writes the layout to chrome.storage.sync", async () => {
      const { layout } = await ext.syncStorage();
      expect(layout).toMatchObject({
        railClosed: ["owners"],
        allKinds: false,
        allRepos: false,
        trendOrder: ["star", "fork", "issue", "pr"],
        trendClosed: [],
      });
    });

    it("keeps the retired default and show fields out of the synced settings", async () => {
      const { settings } = await ext.syncStorage();
      for (const field of RETIRED_SETTINGS) expect(settings ?? {}, `settings.${field}`).not.toHaveProperty(field);
    });

    describe("and reloading the page", () => {
      beforeAll(async () => {
        await page.reload({ waitUntil: "load" });
        await page.waitForSelector("#rail h2", { timeout: 10_000 });
      });

      it("restores the activity and people filters", () =>
        expectRail(page, { kinds: { Issues: false, Stars: true }, hideBots: true, hideMe: false }, "filters after reload"));
      it("restores the period and the grouping", () =>
        expectRail(page, { period: "7", group: "Week" }, "period and grouping after reload"));
      it("restores collapsed rail sections", () => expectRail(page, { closedSections: ["owners"], owners: null }, "layout after reload"));
      it("restores the repository selection", () => expectRail(page, { reposChecked: [repo] }, "repository selection after reload"));
    });
  });

  describe("when another computer changes the synced view", () => {
    beforeAll(async () => {
      await ext.inWorker(async (kinds) => {
        const { view } = await chrome.storage.sync.get<SyncStorage>("view");
        await chrome.storage.sync.set({ view: { ...view, period: "90", hideBots: false, kinds } });
      }, ALL_KINDS);
    });

    it("updates the open page without a reload", async () => {
      await expectRail(page, { period: "90", hideBots: false, kinds: { Issues: true } }, "rail after a synced change");
    });

    it("shows the same state in a second tab", async () => {
      const second = await ext.openPage();
      await expectRail(
        second,
        { period: "90", hideBots: false, reposChecked: [repo], closedSections: ["owners"] },
        "rail in the second tab",
      );
      await second.close();
    });
  });

  describe("Reset filters (Settings → Sync)", () => {
    beforeAll(async () => {
      await clickResetFilters(page);
      await vi.waitFor(async () => expect((await ext.syncStorage()).view?.repos).toEqual([]), { timeout: 10_000, interval: 100 });
    });

    it("clears the repository selection", async () => {
      await expectRail(page, { reposChecked: [] });
    });

    it("keeps the period, which is not a content filter", async () => {
      expect((await ext.syncStorage()).view).toMatchObject({ period: "90", hideBots: false, hideMe: false, kinds: ALL_KINDS, repos: [] });
    });
  });

  describe("Settings", () => {
    beforeAll(async () => {
      await goToSettings(page);
    });

    it("has a Sync section with Reset filters and Reset layout", async () => {
      const buttons = await page.$$eval("#s-sync + .card button", (els) => els.map((b) => b.textContent?.trim()));
      expect(buttons).toEqual(["Reset filters", "Reset layout"]);
    });

    it("no longer has rows for the filters that persist by themselves", async () => {
      const text = await page.$eval(".settings", (el) => el.textContent ?? "");
      expect(text).not.toMatch(/Default period|Default grouping|Show my own activity|Show bot activity/);
    });
  });
});
