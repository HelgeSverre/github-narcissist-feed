/**
 * docs/specs/persistence-and-sync.md, "Migration (schema 1 -> 2)". Needs no GitHub token: the profile is seeded straight
 * into chrome.storage, so these tests run offline.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { expectRail, goToFeed, launchExtension, type ExtensionSession } from "./helpers/browser";

const ALL_KINDS = ["star", "fork", "issue", "pr", "comment", "review", "release"];

let ext: ExtensionSession;
beforeAll(async () => {
  ext = await launchExtension();
});
afterAll(async () => {
  await ext?.close();
});
afterEach(async ({ task }) => {
  await ext.afterTest(task);
});

describe("a brand-new profile", () => {
  it("writes no view, layout or schema to chrome.storage.sync just by loading the page", async () => {
    // Chrome may not have delivered the user's synced prefs yet; writing defaults now would overwrite them.
    const page = await ext.openPage();
    expect(await ext.syncStorage(), "defaults must stay in memory until the user changes something").toEqual({});
    await page.close();
  });
});

describe("a profile with schema-1 data", () => {
  beforeAll(async () => {
    await ext.inWorker(async () => {
      await chrome.storage.sync.clear();
      await chrome.storage.local.remove(["ui", "device"]);
      await chrome.storage.sync.set({
        settings: {
          username: "HelgeSverre",
          owners: [
            { login: "HelgeSverre", type: "user", on: true },
            { login: "sema-lisp", type: "org", on: false },
          ],
          defaultPeriod: "180",
          defaultGroup: "month",
          showOwn: false,
          showBots: false,
          theme: "dark",
          density: "compact",
        },
      });
      await chrome.storage.local.set({
        ui: {
          period: "7",
          group: "week",
          collapsedRail: ["people", "period"],
          allKinds: true,
          trendOrder: ["pr", "star"],
          trendClosed: ["fork"],
          lastOpenedAt: "2026-10-20T10:00:00Z",
        },
      });
    });
    // Opening the page runs the migration (loadPrefs); there is no token, so it opens on Settings.
    await ext.openPage();
    await vi.waitFor(async () => expect((await ext.syncStorage()).schema, "the page never wrote schema 2").toBe(2), {
      timeout: 10_000,
      interval: 100,
    });
  });

  it("builds the view from local ui and the old default/show settings", async () => {
    const { view } = await ext.syncStorage();
    expect(view).toEqual({
      period: "7", // ui wins over settings.defaultPeriod ("180")
      group: "week", // ui wins over settings.defaultGroup ("month")
      kinds: ALL_KINDS,
      hideMe: true, // showOwn: false
      hideBots: true, // showBots: false
      repos: [],
    });
  });

  it("builds the layout from local ui and repairs trendOrder into a full permutation", async () => {
    const { layout } = await ext.syncStorage();
    expect({ ...layout, railClosed: [...(layout?.railClosed ?? [])].toSorted() }).toEqual({
      railClosed: ["people", "period"],
      allKinds: true,
      allRepos: false,
      trendOrder: ["pr", "star", "fork", "issue"],
      trendClosed: ["fork"],
    });
  });

  it("keeps settings and removes the four retired fields", async () => {
    const { settings } = await ext.syncStorage();
    expect(settings).toMatchObject({ username: "HelgeSverre", theme: "dark", density: "compact" });
    expect(settings?.owners, "owners must survive the migration").toEqual([
      { login: "HelgeSverre", type: "user", on: true },
      { login: "sema-lisp", type: "org", on: false },
    ]);
    for (const retired of ["defaultPeriod", "defaultGroup", "showOwn", "showBots"]) {
      expect(settings, `settings.${retired} should be deleted`).not.toHaveProperty(retired);
    }
  });

  it("removes local ui and keeps lastOpenedAt as local device state", async () => {
    const local = await ext.inWorker(() => chrome.storage.local.get(["ui", "device"]));
    expect(local.ui, "legacy ui key").toBeUndefined();
    expect(local.device).toMatchObject({ lastOpenedAt: "2026-10-20T10:00:00Z" });
  });

  it("shows the migrated preferences in the UI", async () => {
    const page = await ext.openPage();
    // No token, so the app opens on Settings and the toolbar has no Day/Week/Month control until we go to the feed.
    await goToFeed(page);
    // People and Period are collapsed by the migrated layout, so their inputs are not rendered at all.
    await expectRail(page, {
      closedSections: ["people", "period"],
      hideMe: null,
      hideBots: null,
      period: null,
      group: "Week",
      resetVisible: true, // hideMe/hideBots differ from the defaults, although the People section is collapsed
      owners: { HelgeSverre: true, "sema-lisp": false },
    });
    expect(await page.$eval("html", (el) => [el.getAttribute("data-theme"), el.getAttribute("data-density")])).toEqual(["dark", "compact"]);
  });
});
