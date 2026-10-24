/**
 * Core flow against the real GitHub API: token -> full sweep -> feed, adding an owner from the popover, stacking,
 * trend charts, settings, density, the manifest and the refresh alarms.
 *
 * The tests build on each other like one user session: a full sweep takes about 30 s, so it runs once in the first
 * tests and the rest reuse its data. Needs GITHUB_TOKEN or an authenticated `gh` CLI.
 */
import type { Page } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Kind } from "../../src/lib/types";
import {
  count,
  expectRail,
  fetchViewer,
  githubToken,
  goToFeed,
  chooseRailPeriod,
  goToSettings,
  launchExtension,
  storeToken,
  waitForFullSweep,
  type ExtensionSession,
  type GithubViewer,
  type LocalStorage,
  type RefreshStatus,
} from "./helpers/browser";

/** An organization the signed-in account can add as an owner (it is Helge's own, with a public repository `sema`). */
const EXTRA_OWNER = { login: "sema-lisp", repo: "sema-lisp/sema" };
const KINDS: Kind[] = ["star", "fork", "issue", "pr", "comment", "review", "release"];

const token = githubToken();

describe.skipIf(!token)("feed with a real token (needs GITHUB_TOKEN or an authenticated `gh` CLI)", () => {
  let ext: ExtensionSession;
  let page: Page;
  let viewer: GithubViewer;
  let sweep: RefreshStatus;

  beforeAll(async () => {
    viewer = await fetchViewer(token!);
    ext = await launchExtension();
  });
  afterAll(async () => {
    await ext?.close();
  });
  afterEach(async ({ task }) => {
    await ext.afterTest(task);
  });

  it("opens the setup wizard on a fresh profile", async () => {
    page = await ext.openPage();
    await page.waitForSelector("#setup-username");
    expect(await page.$eval("#setup-title", (el) => el.textContent)).toBe("Your GitHub, about you.");
  });

  it("validates the token and finishes a full sweep without errors", async () => {
    await storeToken(page, token!);
    sweep = await waitForFullSweep(page);
    expect(sweep.tokenOk, `token rejected: ${sweep.tokenError}`).toBe(true);
    expect(sweep.viewer).toBe(viewer.login);
    expect(sweep.lastError ?? null, "the sweep reported an error").toBeNull();
  });

  it("seeds the username and the viewer as the first owner", async () => {
    const { settings } = await ext.syncStorage();
    expect(settings?.username).toBe(viewer.login);
    expect(settings?.owners).toEqual([{ login: viewer.login, type: "user", on: true }]);
  });

  it("caches events of every kind, owners, people and a ledger covering the viewer's repositories", async () => {
    const stored = await page.evaluate(async () => {
      const r = await chrome.storage.local.get<LocalStorage>(["events", "owners", "people", "ledger"]);
      const kinds: Partial<Record<Kind, number>> = {};
      for (const e of Object.values(r.events ?? {})) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
      return {
        events: Object.values(r.events ?? {}).length,
        kinds,
        owners: Object.keys(r.owners ?? {}),
        people: (r.people ?? []).length,
        repos: Object.keys(r.ledger ?? {}).length,
      };
    });
    expect(stored.events, "cached events").toBeGreaterThan(100);
    for (const kind of KINDS)
      expect(stored.kinds[kind] ?? 0, `events of kind "${kind}" (all kinds: ${JSON.stringify(stored.kinds)})`).toBeGreaterThan(0);
    expect(stored.owners, "owner metadata").toContain(viewer.login);
    expect(stored.people, "people for the add-owner popover").toBeGreaterThan(0);
    // Every public repository the account owns gets a ledger entry (private ones come on top). Allow a little slack for repos created mid-test.
    expect(stored.repos, `ledger entries (account has ${viewer.publicRepos} public repositories)`).toBeGreaterThanOrEqual(
      Math.floor(viewer.publicRepos * 0.9),
    );
  });

  it("offers an organization in the add-owner popover and fetches its repositories once added", async () => {
    await goToFeed(page);
    await page.waitForSelector("#q");
    await page.click('button[title="Add users or organizations"]');
    await page.waitForSelector("#pop");
    await page.type("#pop input[type=search]", EXTRA_OWNER.login);
    // Local people show at once; GitHub search results arrive after a debounce and a request.
    const rowHandle = await page.waitForFunction(
      (login) =>
        [...document.querySelectorAll("#pop label.frow")].find((l) => l.querySelector(".lbl")?.textContent?.trim() === login) ?? null,
      { timeout: 20_000 },
      EXTRA_OWNER.login,
    );
    await (await rowHandle.asElement()!.$("input[type=checkbox]"))!.click();
    await page.keyboard.press("Escape");

    await page.waitForFunction(
      async (repo) => {
        const { status, ledger } = await chrome.storage.local.get<LocalStorage>(["status", "ledger"]);
        return status?.lastFullAt && !status.refreshing && ledger?.[repo] ? true : null;
      },
      { timeout: 240_000, polling: 2000 },
      EXTRA_OWNER.repo,
    );
    const { settings } = await ext.syncStorage();
    expect(
      settings?.owners.map((o) => [o.login, o.on]),
      "owners after adding",
    ).toEqual([
      [viewer.login, true],
      [EXTRA_OWNER.login, true],
    ]);
  });

  it("renders feed rows grouped by day", async () => {
    await page.waitForFunction(() => document.querySelectorAll("#col .row").length > 10, { timeout: 20_000 });
    expect(await count(page, "#col .row"), "feed rows").toBeGreaterThan(10);
    expect(await count(page, "#col button.day"), "day group headings").toBeGreaterThan(0);
    await expectRail(page, { group: "Day" });
  });

  it("draws one chart per trend panel", async () => {
    expect(await count(page, "#side .tbody svg"), "trend charts (stars, forks, issues, pull requests)").toBe(4);
  });

  it("stacks repeated actions and expands a stack on click", async () => {
    expect(await count(page, "#col .row.stack"), "stacked rows").toBeGreaterThan(0);
    expect(await count(page, "#col .kids .row"), "child rows before expanding").toBe(0);
    await page.bringToFront();
    // The count badge, not the row's middle: the actor and repository names in the row are links.
    await page.click("#col .row.stack .cnt");
    await page.waitForSelector("#col .kids .row", { timeout: 5_000 });
  });

  it("lists both owners, checked, in the rail", async () => {
    await expectRail(page, { owners: { [viewer.login]: true, [EXTRA_OWNER.login]: true } }, "owners in the rail");
  });

  it("loads avatars, so the CSP lets avatars.githubusercontent.com through", async () => {
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>("#col .row .av img")].every((i) => i.complete), {
      timeout: 20_000,
    });
    const avatars = await page.$$eval("#col .row .av img", (imgs) => ({
      total: imgs.length,
      broken: imgs.filter((i) => i.naturalWidth === 0).map((i) => i.src),
    }));
    expect(avatars.total, "avatar images in the feed").toBeGreaterThan(0);
    expect(avatars.broken, "avatars that failed to load").toEqual([]);
  });

  it("shows the validated token in Settings", async () => {
    await goToSettings(page);
    expect(await page.$eval(".kv li .v", (el) => el.textContent?.trim())).toMatch(new RegExp(`^Valid as ${viewer.login}\\b`));
  });

  it("applies the density setting to the whole page and removes it again", async () => {
    const density = "#s-appearance + .card select[aria-label=Density]";
    const attr = () => page.$eval("html", (el) => el.getAttribute("data-density"));
    expect(await attr(), "before").toBeNull();
    await page.select(density, "compact");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-density") === "compact", { timeout: 5_000 });
    await page.select(density, "default");
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-density"), { timeout: 5_000 });
  });

  it("leaves Chrome's new-tab page alone", async () => {
    const manifest = await ext.inWorker(() => chrome.runtime.getManifest());
    expect(manifest.chrome_url_overrides, "no new-tab override").toBeUndefined();
    expect(manifest.permissions, "no tabs permission").not.toContain("tabs");
  });

  it("schedules the quick (10 min) and full (60 min) refresh alarms in the service worker", async () => {
    const alarms = await ext.inWorker(async () => (await chrome.alarms.getAll()).map((a) => [a.name, a.periodInMinutes]));
    expect(alarms.toSorted()).toEqual([
      ["full", 60],
      ["quick", 10],
    ]);
  });

  describe("collapse all", () => {
    type Header = { collapsed: boolean; count: string };
    const headers = (): Promise<Header[]> =>
      page.$$eval("#col button.day", (bs) =>
        bs.map((b) => ({ collapsed: b.classList.contains("collapsed"), count: b.querySelector(".dcnt")?.textContent?.trim() ?? "" })),
      );
    const toggleAll = async () => {
      await page.bringToFront();
      await page.click('#toolbar button[aria-label$="all groups"]');
    };
    /** Scrolls to the end until no more rows load; returns the headers. */
    const scrollToEnd = async () => {
      for (let i = 0; i < 20 && (await page.$("#col .sentinel")); i++) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await new Promise((r) => setTimeout(r, 150));
      }
      return headers();
    };

    beforeAll(async () => {
      await goToFeed(page);
      await chooseRailPeriod(page, "365");
      await page.waitForSelector("#col .sentinel", { timeout: 10_000 });
    });
    afterAll(async () => {
      await chooseRailPeriod(page, "30");
    });

    it("keeps header counts stable while more rows load", async () => {
      const before = await headers();
      const after = await scrollToEnd();
      expect(after.length, "more groups after scrolling").toBeGreaterThan(before.length);
      expect(after.slice(0, before.length).map((h) => h.count)).toEqual(before.map((h) => h.count));
    });

    it("collapses every group at once and persists the default", async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await toggleAll();
      const hs = await headers();
      expect(hs.length).toBeGreaterThan(1);
      expect(
        hs.every((h) => h.collapsed),
        "every group collapsed",
      ).toBe(true);
      expect(await page.$("#col .sentinel"), "collapsed groups need no more loading").toBeNull();
      await vi.waitFor(async () => expect((await ext.syncStorage()).layout?.groupsCollapsed).toBe(true), { timeout: 5_000 });
    });

    it("keeps a group opened by hand as the only exception", async () => {
      await page.click("#col button.day");
      const hs = await headers();
      expect(hs[0].collapsed).toBe(false);
      expect(hs.slice(1).every((h) => h.collapsed)).toBe(true);
    });

    it("after a reload, keeps the default and forgets hand-opened groups", async () => {
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector("#col button.day", { timeout: 15_000 });
      expect((await headers()).every((h) => h.collapsed)).toBe(true);
    });

    it("expands every group, including ones loaded later", async () => {
      await toggleAll();
      expect((await headers()).some((h) => h.collapsed)).toBe(false);
      const hs = await scrollToEnd();
      expect(
        hs.some((h) => h.collapsed),
        "groups loaded after Expand all are open",
      ).toBe(false);
    });
  });
});
