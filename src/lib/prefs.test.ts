import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock, uninstallChromeMock, type ChromeMock } from "../../tests/helpers/chrome-mock";
import type { OwnerConfig } from "./types";

type PrefsModule = typeof import("./prefs");

let mock: ChromeMock;
let p: PrefsModule;

/** A fresh copy of the module with empty module state: one "page" (tab) per call. All copies share the same chrome mock. */
async function freshModule(): Promise<PrefsModule> {
  vi.resetModules();
  return import("./prefs");
}

/** loadPrefs, then forget the writes it made so a test can count only its own. */
/** Load an established schema-2 profile (sync seeded with defaults unless the test seeded something). */
async function load(mod: PrefsModule = p) {
  if (Object.keys(mock.sync.dump()).length === 0)
    mock.sync.seed({ settings: mod.DEFAULT_SETTINGS, view: mod.DEFAULT_VIEW, layout: mod.DEFAULT_LAYOUT, schema: 2 });
  const prefs = await mod.loadPrefs();
  mock.sync.setCalls.length = 0;
  mock.local.setCalls.length = 0;
  mock.local.removeCalls.length = 0;
  return prefs;
}

const view = (patch: Partial<import("./prefs").ViewPrefs> = {}) => ({
  ...p.DEFAULT_VIEW,
  kinds: [...p.DEFAULT_VIEW.kinds],
  repos: [],
  ...patch,
});
const layout = (patch: Partial<import("./prefs").LayoutPrefs> = {}) => ({
  ...p.DEFAULT_LAYOUT,
  railClosed: [],
  trendOrder: [...p.DEFAULT_LAYOUT.trendOrder],
  trendClosed: [],
  ...patch,
});
const bytes = (key: string, value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length + key.length;

beforeEach(async () => {
  vi.useFakeTimers();
  mock = installChromeMock();
  p = await freshModule();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  uninstallChromeMock();
});

// ---------------------------------------------------------------------------------------------------------------------
describe("defaults", () => {
  it("exports the documented constants", () => {
    expect(p.SCHEMA_VERSION).toBe(2);
    expect(p.DEBOUNCE_MS).toBe(400);
    expect(p.MAX_REPOS).toBe(100);
    expect(p.MAX_ITEM_BYTES).toBe(8000);
    expect(p.RAIL_KIND_IDS).not.toContain("unstar");
    expect(p.RAIL_KIND_IDS).not.toContain("unfork");
    expect(p.TREND_KINDS).toEqual(["star", "fork", "issue", "pr"]);
  });

  it("DEFAULT_VIEW and DEFAULT_LAYOUT match the spec", () => {
    expect(p.DEFAULT_VIEW).toEqual({
      period: "30",
      group: "day",
      kinds: ["star", "fork", "issue", "pr", "comment", "review", "release"],
      hideMe: false,
      hideBots: false,
      repos: [],
    });
    expect(p.DEFAULT_LAYOUT).toEqual({
      railClosed: [],
      allKinds: false,
      allRepos: false,
      trendOrder: ["star", "fork", "issue", "pr"],
      trendClosed: [],
    });
  });

  it("sanitize(undefined) gives each default, as fresh objects", () => {
    expect(p.sanitize("settings", undefined)).toEqual(p.DEFAULT_SETTINGS);
    expect(p.sanitize("view", undefined)).toEqual(p.DEFAULT_VIEW);
    expect(p.sanitize("layout", undefined)).toEqual(p.DEFAULT_LAYOUT);
    const a = p.sanitize("view", undefined);
    a.kinds.pop();
    a.repos.push("a/b");
    expect(p.DEFAULT_VIEW.kinds).toHaveLength(7);
    expect(p.DEFAULT_VIEW.repos).toEqual([]);
    const l = p.sanitize("layout", undefined);
    l.trendOrder.reverse();
    expect(p.DEFAULT_LAYOUT.trendOrder).toEqual(["star", "fork", "issue", "pr"]);
    const s = p.sanitize("settings", undefined);
    s.owners.push({ login: "x", type: "user", on: true });
    expect(p.DEFAULT_SETTINGS.owners).toEqual([]);
  });

  it("loadPrefs on an empty profile returns defaults and writes nothing (synced data may not have arrived yet)", async () => {
    const prefs = await p.loadPrefs();
    expect(prefs).toEqual({ settings: p.DEFAULT_SETTINGS, view: p.DEFAULT_VIEW, layout: p.DEFAULT_LAYOUT });
    expect(mock.sync.dump()).toEqual({});
    expect(mock.local.dump()).toEqual({});
  });

  it("on an empty profile, synced data arriving later is delivered and the first user change is written", async () => {
    const seen: unknown[] = [];
    await p.loadPrefs();
    p.onPrefsChange((key, value) => seen.push([key, value]));
    await mock.sync.set({ view: { ...p.DEFAULT_VIEW, period: "90" }, schema: 2 });
    await vi.runAllTimersAsync();
    expect(seen).toEqual([["view", { ...p.DEFAULT_VIEW, period: "90" }]]);
    p.savePref("layout", { ...p.DEFAULT_LAYOUT, allKinds: true });
    await p.flushPrefs();
    expect(mock.sync.dump().layout).toEqual({ ...p.DEFAULT_LAYOUT, allKinds: true });
  });

  it("a fresh profile records schema 2 with its first write, and only once", async () => {
    await p.loadPrefs();
    p.savePref("view", { ...p.DEFAULT_VIEW, period: "7" });
    await p.flushPrefs();
    p.savePref("layout", { ...p.DEFAULT_LAYOUT, allKinds: true });
    await p.flushPrefs();
    expect(mock.sync.setCalls).toEqual([
      { view: { ...p.DEFAULT_VIEW, period: "7" }, schema: 2 },
      { layout: { ...p.DEFAULT_LAYOUT, allKinds: true } },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("sanitize", () => {
  const GARBAGE: unknown[] = [null, undefined, 0, 42, NaN, "", "view", true, false, [], [1, "a", null], () => 1, Symbol("x"), 10n];

  it.each(["settings", "view", "layout"] as const)("returns the defaults for non-object input (%s)", (key) => {
    const defaults = { settings: p.DEFAULT_SETTINGS, view: p.DEFAULT_VIEW, layout: p.DEFAULT_LAYOUT }[key];
    for (const g of GARBAGE) expect(() => p.sanitize(key, g)).not.toThrow();
    for (const g of GARBAGE) expect(p.sanitize(key, g)).toEqual(defaults);
  });

  it("never throws, even on throwing getters or revoked proxies", () => {
    const evil = Object.defineProperty({}, "period", {
      enumerable: true,
      get: () => {
        throw new Error("boom");
      },
    });
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    for (const key of ["settings", "view", "layout"] as const) {
      expect(() => p.sanitize(key, evil)).not.toThrow();
      expect(() => p.sanitize(key, proxy)).not.toThrow();
    }
    expect(p.sanitize("view", evil)).toEqual(p.DEFAULT_VIEW);
  });

  it("is idempotent", () => {
    const messy = { period: "7", kinds: ["pr", "pr", "bogus", "star"], repos: ["a/b", "a/b", "nope"], hideMe: "yes", extra: 1 };
    const once = p.sanitize("view", messy);
    expect(p.sanitize("view", once)).toEqual(once);
    const l = p.sanitize("layout", { trendOrder: ["pr", "x"], railClosed: ["people", "people"] });
    expect(p.sanitize("layout", l)).toEqual(l);
  });

  describe("settings", () => {
    it("keeps valid values", () => {
      const owners: OwnerConfig[] = [
        { login: "HelgeSverre", type: "user", on: true },
        { login: "acme", type: "org", on: false },
      ];
      const custom = {
        username: "HelgeSverre",
        owners,
        includePrivate: false,
        refreshMinutes: 30,
        showUnstars: true,
        trends: false,
        stack: false,
        stackScope: "repo",
        stackRepoWindow: 15,
        stackOrgWindow: 60,
        dateFormat: "iso",
        timeFormat: "12",
        weekStart: 0,
        theme: "dark",
        accent: "#a142f4",
        density: "compact",
      };
      expect(p.sanitize("settings", custom)).toEqual(custom);
    });

    it("keeps an accent only as a canonical #rrggbb hex, and the default for anything else", () => {
      const accent = (v: unknown) => p.sanitize("settings", { accent: v }).accent;
      expect(accent("#A142F4")).toBe("#a142f4");
      expect(accent("0b8043")).toBe("#0b8043");
      expect(accent("#fa3")).toBe("#ffaa33");
      for (const bad of ["red", "#12345", "#1234567", "#a142f480", "rgb(1, 2, 3)", "#gggggg", 0x1a73e8, null]) expect(accent(bad)).toBe("");
    });

    it("replaces wrong types and enum values with defaults, field by field", () => {
      const out = p.sanitize("settings", {
        username: 5,
        owners: "me",
        includePrivate: "yes",
        refreshMinutes: 7,
        showUnstars: 1,
        trends: null,
        stack: "no",
        stackScope: "planet",
        stackRepoWindow: "60",
        stackOrgWindow: -1,
        dateFormat: "dd/mm",
        timeFormat: 24,
        weekStart: 2,
        theme: "solarized",
        density: "tiny",
        refreshMinutesTypo: 1,
      });
      expect(out).toEqual(p.DEFAULT_SETTINGS);
    });

    it("keeps the good fields of a partial object and defaults the rest", () => {
      const out = p.sanitize("settings", { theme: "dark", refreshMinutes: 0, username: "me", weekStart: "monday" });
      expect(out).toEqual({ ...p.DEFAULT_SETTINGS, theme: "dark", refreshMinutes: 0, username: "me" });
    });

    it("drops unknown fields and the four removed ones", () => {
      const out = p.sanitize("settings", {
        theme: "light",
        defaultPeriod: "90",
        defaultGroup: "week",
        showOwn: false,
        showBots: false,
        somethingNew: { a: 1 },
      });
      expect(out).toEqual({ ...p.DEFAULT_SETTINGS, theme: "light" });
      for (const k of ["defaultPeriod", "defaultGroup", "showOwn", "showBots", "somethingNew"]) expect(out).not.toHaveProperty(k);
    });

    it("validates owner entries", () => {
      const out = p.sanitize("settings", {
        owners: [
          { login: "a", type: "user", on: true },
          { login: "b", type: "org", on: false, extra: 1 },
          { login: "A", type: "user", on: true }, // duplicate (case-insensitive)
          { login: "c" }, // partial: repaired
          { login: "d", type: "alien", on: "yes" }, // wrong enum / type: repaired
          { login: 5, type: "user", on: true }, // no usable login: dropped
          { login: "  ", type: "user", on: true },
          "junk",
          null,
          [],
        ],
      });
      expect(out.owners).toEqual([
        { login: "a", type: "user", on: true },
        { login: "b", type: "org", on: false },
        { login: "c", type: "user", on: true },
        { login: "d", type: "user", on: true },
      ]);
    });

    it("rejects non-finite and negative numbers", () => {
      expect(p.sanitize("settings", { stackRepoWindow: Infinity, stackOrgWindow: NaN })).toMatchObject({
        stackRepoWindow: 60,
        stackOrgWindow: 180,
      });
      expect(p.sanitize("settings", { stackRepoWindow: 0, stackOrgWindow: 1440 })).toMatchObject({
        stackRepoWindow: 0,
        stackOrgWindow: 1440,
      });
    });
  });

  describe("view", () => {
    it("accepts every Period and Group value", () => {
      for (const period of ["today", "7", "30", "90", "180", "365", "all"]) expect(p.sanitize("view", { period }).period).toBe(period);
      for (const group of ["day", "week", "month"]) expect(p.sanitize("view", { group }).group).toBe(group);
    });

    it("replaces wrong enums and types", () => {
      expect(p.sanitize("view", { period: "14", group: "year", hideMe: "true", hideBots: 1, kinds: "star", repos: "a/b" })).toEqual(
        p.DEFAULT_VIEW,
      );
      expect(p.sanitize("view", { period: 7 }).period).toBe("30");
    });

    it("filters kinds to the rail kinds and dedupes, keeping order", () => {
      expect(p.sanitize("view", { kinds: ["pr", "unstar", "star", "pr", "unfork", "bogus", 3] }).kinds).toEqual(["pr", "star"]);
    });

    it("keeps an empty kinds list (a real choice) but not an all-garbage one", () => {
      expect(p.sanitize("view", { kinds: [] }).kinds).toEqual([]);
      expect(p.sanitize("view", { kinds: ["unstar", "x"] }).kinds).toEqual(p.RAIL_KIND_IDS);
    });

    it("keeps only owner/name strings, deduped", () => {
      const out = p.sanitize("view", {
        repos: ["a/b", "a/b", "c/d.js", "x_y/z-1", "noslash", "a/b/c", "/b", "a/", "has space/x", "", 7, null, { a: 1 }],
      });
      expect(out.repos).toEqual(["a/b", "c/d.js", "x_y/z-1"]);
    });

    it("caps repos at MAX_REPOS keeping the most recent (end of array)", () => {
      const many = Array.from({ length: 150 }, (_, i) => `o/r${i}`);
      const out = p.sanitize("view", { repos: many }).repos;
      expect(out).toHaveLength(p.MAX_REPOS);
      expect(out[0]).toBe("o/r50");
      expect(out.at(-1)).toBe("o/r149");
    });

    it("drops unknown fields", () => {
      expect(p.sanitize("view", { period: "7", mystery: true })).not.toHaveProperty("mystery");
    });
  });

  describe("layout", () => {
    it("keeps valid values", () => {
      const l = {
        railClosed: ["people", "owners"],
        allKinds: true,
        allRepos: true,
        trendOrder: ["pr", "issue", "fork", "star"],
        trendClosed: ["fork", "star"],
      };
      expect(p.sanitize("layout", l)).toEqual(l);
    });

    it("filters railClosed to known sections and dedupes", () => {
      expect(p.sanitize("layout", { railClosed: ["people", "kinds", "people", "repositories", 4] }).railClosed).toEqual([
        "people",
        "repositories",
      ]);
    });

    it("repairs a broken trendOrder into a full permutation", () => {
      const cases: [unknown, string[]][] = [
        [undefined, ["star", "fork", "issue", "pr"]],
        [[], ["star", "fork", "issue", "pr"]],
        [["pr"], ["pr", "star", "fork", "issue"]],
        [
          ["pr", "star"],
          ["pr", "star", "fork", "issue"],
        ],
        [
          ["pr", "pr", "bogus", "star", "star"],
          ["pr", "star", "fork", "issue"],
        ],
        [
          ["unstar", "comment", 1, null],
          ["star", "fork", "issue", "pr"],
        ],
        [
          ["pr", "issue", "fork", "star", "extra"],
          ["pr", "issue", "fork", "star"],
        ],
        ["pr", ["star", "fork", "issue", "pr"]],
      ];
      for (const [input, expected] of cases) expect(p.sanitize("layout", { trendOrder: input }).trendOrder).toEqual(expected);
    });

    it("filters trendClosed", () => {
      expect(p.sanitize("layout", { trendClosed: ["fork", "fork", "comment", 1] }).trendClosed).toEqual(["fork"]);
    });

    it("defaults wrong booleans", () => {
      expect(p.sanitize("layout", { allKinds: "yes", allRepos: 1 })).toMatchObject({ allKinds: false, allRepos: false });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("migration schema 1 -> 2", () => {
  const ui = {
    period: "7",
    group: "week",
    collapsedRail: ["people"],
    allKinds: true,
    trendOrder: ["pr", "star"],
    trendClosed: ["fork"],
    lastOpenedAt: "2026-10-20T09:15:00.000Z",
  };
  const oldSettings = {
    username: "HelgeSverre",
    owners: [
      { login: "HelgeSverre", type: "user", on: true },
      { login: "acme", type: "org", on: false },
    ],
    includePrivate: false,
    refreshMinutes: 5,
    showUnstars: true,
    trends: true,
    stack: true,
    stackScope: "org",
    stackRepoWindow: 60,
    stackOrgWindow: 180,
    dateFormat: "iso",
    timeFormat: "24",
    weekStart: 1,
    theme: "dark",
    density: "compact",
    defaultPeriod: "90",
    defaultGroup: "month",
    showOwn: false,
    showBots: false,
  };
  const expectedView = {
    period: "7",
    group: "week",
    kinds: ["star", "fork", "issue", "pr", "comment", "review", "release"],
    hideMe: true,
    hideBots: true,
    repos: [],
  };
  const expectedLayout = {
    railClosed: ["people"],
    allKinds: true,
    allRepos: false,
    trendOrder: ["pr", "star", "fork", "issue"],
    trendClosed: ["fork"],
  };
  const { defaultPeriod: _a, defaultGroup: _b, showOwn: _c, showBots: _d, ...kept } = oldSettings;
  /** Schema 1 had no accent; migrated settings get the default. */
  const expectedSettings = { ...kept, accent: "" };

  beforeEach(() => {
    mock.local.seed({ ui, token: "ghp_secret", events: { x: 1 } });
    mock.sync.seed({ settings: oldSettings });
  });

  it("builds view, layout and settings from realistic schema-1 data and writes them in one sync.set", async () => {
    const prefs = await p.loadPrefs();
    expect(prefs.view).toEqual(expectedView);
    expect(prefs.layout).toEqual(expectedLayout);
    expect(prefs.settings).toEqual(expectedSettings);
    expect(mock.sync.dump()).toEqual({ view: expectedView, layout: expectedLayout, settings: expectedSettings, schema: 2 });
    expect(mock.sync.setCalls).toHaveLength(1);
    expect(Object.keys(mock.sync.setCalls[0]).toSorted()).toEqual(["layout", "schema", "settings", "view"]);
  });

  it("removes local ui, writes device with lastOpenedAt, and leaves other local data alone", async () => {
    await p.loadPrefs();
    const local = mock.local.dump();
    expect(local).not.toHaveProperty("ui");
    expect(local.device).toEqual({ lastOpenedAt: "2026-10-20T09:15:00.000Z" });
    expect(local.token).toBe("ghp_secret");
    expect(local.events).toEqual({ x: 1 });
  });

  it("takes period and group from the old settings defaults when ui has none", async () => {
    mock.local.seed({ ui: { collapsedRail: [] } });
    const prefs = await p.loadPrefs();
    expect(prefs.view).toMatchObject({ period: "90", group: "month" });
  });

  it("falls through a garbage ui.period to settings.defaultPeriod, then to the default", async () => {
    mock.local.seed({ ui: { period: "fortnight", group: 3 } });
    expect((await p.loadPrefs()).view).toMatchObject({ period: "90", group: "month" });

    mock.sync.seed({ schema: undefined });
    await mock.sync.remove("schema");
    await mock.sync.remove(["view", "layout"]);
    mock.sync.seed({ settings: { ...oldSettings, defaultPeriod: "nope", defaultGroup: null } });
    mock.local.seed({ ui: { period: "fortnight" } });
    p = await freshModule();
    expect((await p.loadPrefs()).view).toMatchObject({ period: "30", group: "day" });
  });

  it("maps showOwn/showBots to hideMe/hideBots, and leaves them visible when true or missing", async () => {
    mock.sync.seed({ settings: { ...oldSettings, showOwn: true, showBots: true } });
    expect((await p.loadPrefs()).view).toMatchObject({ hideMe: false, hideBots: false });
    await mock.sync.remove(["schema", "view", "layout"]);
    mock.local.seed({ ui });
    mock.sync.seed({ settings: { username: "x" } });
    p = await freshModule();
    expect((await p.loadPrefs()).view).toMatchObject({ hideMe: false, hideBots: false });
  });

  it("copes with garbage in ui and settings", async () => {
    mock.local.seed({
      ui: { period: 5, group: [], collapsedRail: "people", allKinds: "yes", trendOrder: { a: 1 }, trendClosed: null, lastOpenedAt: 12 },
    });
    mock.sync.seed({ settings: "oops" });
    const prefs = await p.loadPrefs();
    expect(prefs).toEqual({ settings: p.DEFAULT_SETTINGS, view: p.DEFAULT_VIEW, layout: p.DEFAULT_LAYOUT });
    expect(mock.sync.dump().schema).toBe(2);
    expect(mock.local.dump()).not.toHaveProperty("ui");
    expect(mock.local.dump()).not.toHaveProperty("device"); // lastOpenedAt was not a string
  });

  it("is idempotent: a second load changes nothing and writes nothing", async () => {
    const first = await p.loadPrefs();
    const syncAfterFirst = mock.sync.dump();
    const localAfterFirst = mock.local.dump();
    mock.sync.setCalls.length = 0;
    const secondSamePage = await p.loadPrefs();
    p = await freshModule();
    const secondNewPage = await p.loadPrefs();
    expect(secondSamePage).toEqual(first);
    expect(secondNewPage).toEqual(first);
    expect(mock.sync.dump()).toEqual(syncAfterFirst);
    expect(mock.local.dump()).toEqual(localAfterFirst);
    expect(mock.sync.setCalls).toHaveLength(0);
  });

  it("gives the same result when two computers/tabs migrate at once", async () => {
    const other = await freshModule();
    const [a, b] = await Promise.all([p.loadPrefs(), other.loadPrefs()]);
    expect(a).toEqual(b);
    expect(mock.sync.dump()).toEqual({ view: expectedView, layout: expectedLayout, settings: expectedSettings, schema: 2 });
    expect(mock.local.dump().device).toEqual({ lastOpenedAt: ui.lastOpenedAt });
    expect(mock.local.dump()).not.toHaveProperty("ui");
  });

  it("keeps sync view/layout that another computer wrote first", async () => {
    const theirView = { period: "all", group: "day", kinds: ["pr"], hideMe: false, hideBots: true, repos: ["acme/site"] };
    const theirLayout = {
      railClosed: ["owners"],
      allKinds: false,
      allRepos: true,
      trendOrder: ["issue", "pr", "fork", "star"],
      trendClosed: [],
    };
    mock.sync.seed({ view: theirView, layout: theirLayout });
    const prefs = await p.loadPrefs();
    expect(prefs.view).toEqual(theirView);
    expect(prefs.layout).toEqual(theirLayout);
    expect(prefs.settings).toEqual(expectedSettings); // still stripped of the four old fields
    expect(mock.sync.dump()).toEqual({ view: theirView, layout: theirLayout, settings: expectedSettings, schema: 2 });
    expect(mock.local.dump()).not.toHaveProperty("ui");
    expect(mock.local.dump().device).toEqual({ lastOpenedAt: ui.lastOpenedAt });
  });

  it("keeps only the key that exists when just one of view/layout is already in sync", async () => {
    const theirView = { ...expectedView, period: "365", hideMe: false };
    mock.sync.seed({ view: theirView });
    const prefs = await p.loadPrefs();
    expect(prefs.view).toEqual(theirView);
    expect(prefs.layout).toEqual(expectedLayout);
  });

  it("only cleans up local ui when another computer already finished the migration (schema 2 in sync)", async () => {
    const theirView = { ...expectedView, period: "today" };
    mock.sync.seed({ view: theirView, layout: expectedLayout, settings: expectedSettings, schema: 2 });
    const prefs = await p.loadPrefs();
    expect(prefs.view).toEqual(theirView);
    expect(mock.sync.setCalls).toHaveLength(0);
    expect(mock.local.dump()).not.toHaveProperty("ui");
    expect(mock.local.dump().device).toEqual({ lastOpenedAt: ui.lastOpenedAt });
  });

  it("does not overwrite an existing device.lastOpenedAt", async () => {
    mock.local.seed({ device: { lastOpenedAt: "2026-10-21T00:00:00.000Z" } });
    await p.loadPrefs();
    expect(mock.local.dump().device).toEqual({ lastOpenedAt: "2026-10-21T00:00:00.000Z" });
    expect(mock.local.dump()).not.toHaveProperty("ui");
  });

  it("does not write device when there was no lastOpenedAt", async () => {
    mock.local.seed({ ui: { period: "7" } });
    await p.loadPrefs();
    expect(mock.local.dump()).not.toHaveProperty("device");
    expect(mock.local.dump()).not.toHaveProperty("ui");
  });

  it("returns the migrated values but keeps ui and schema when the sync write fails, then finishes on the next load", async () => {
    mock.failNextSyncSet();
    const prefs = await p.loadPrefs();
    expect(prefs.view).toEqual(expectedView);
    expect(prefs.layout).toEqual(expectedLayout);
    expect(mock.sync.dump()).toEqual({ settings: oldSettings }); // untouched
    expect(mock.local.dump().ui).toEqual(ui); // not removed: nothing would be left to migrate from
    p = await freshModule();
    const again = await p.loadPrefs();
    expect(again).toEqual(prefs);
    expect(mock.sync.dump()).toEqual({ view: expectedView, layout: expectedLayout, settings: expectedSettings, schema: 2 });
    expect(mock.local.dump()).not.toHaveProperty("ui");
  });

  it("does not migrate (and so cannot overwrite real data with defaults) when sync cannot be read", async () => {
    vi.spyOn(mock.sync, "get").mockRejectedValue(new Error("sync unavailable"));
    const prefs = await p.loadPrefs();
    expect(prefs).toEqual({ settings: p.DEFAULT_SETTINGS, view: p.DEFAULT_VIEW, layout: p.DEFAULT_LAYOUT });
    expect(mock.sync.setCalls).toHaveLength(0);
    expect(mock.local.dump().ui).toEqual(ui);
  });

  it("does not migrate again when schema is already newer than 2", async () => {
    mock.sync.seed({ schema: 3, view: { period: "today" } });
    const prefs = await p.loadPrefs();
    expect(prefs.view.period).toBe("today");
    expect(mock.sync.setCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("savePref: debounce, coalescing, skipping equal values", () => {
  it("writes nothing before DEBOUNCE_MS and one sync.set after", async () => {
    await load();
    p.savePref("view", view({ period: "7" }));
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS - 1);
    expect(mock.sync.setCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.sync.setCalls).toEqual([{ view: view({ period: "7" }) }]);
  });

  it("coalesces several saves of a key into one write with the last value", async () => {
    await load();
    p.savePref("view", view({ period: "7" }));
    p.savePref("view", view({ period: "90" }));
    p.savePref("view", view({ period: "all", group: "week" }));
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS);
    await p.flushPrefs();
    expect(mock.sync.setCalls).toEqual([{ view: view({ period: "all", group: "week" }) }]);
    expect(mock.sync.dump().view).toEqual(view({ period: "all", group: "week" }));
  });

  it("restarts the timer on every save", async () => {
    await load();
    p.savePref("view", view({ period: "7" }));
    await vi.advanceTimersByTimeAsync(300);
    p.savePref("view", view({ period: "90" }));
    await vi.advanceTimersByTimeAsync(300);
    expect(mock.sync.setCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(mock.sync.setCalls).toEqual([{ view: view({ period: "90" }) }]);
  });

  it("debounces each key on its own", async () => {
    await load();
    p.savePref("view", view({ period: "7" }));
    p.savePref("layout", layout({ allKinds: true }));
    p.savePref("settings", { ...p.DEFAULT_SETTINGS, theme: "dark" });
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS);
    expect(mock.sync.setCalls).toHaveLength(3);
    expect(mock.sync.setCalls.map((c) => Object.keys(c)[0]).toSorted()).toEqual(["layout", "settings", "view"]);
  });

  it("sanitises what it writes", async () => {
    await load();
    p.savePref("view", { ...view(), period: "bogus", kinds: ["pr", "unstar"], mystery: 1 } as never);
    await p.flushPrefs();
    expect(mock.sync.dump().view).toEqual(view({ kinds: ["pr"] }));
  });

  it("skips a value equal to the one loaded", async () => {
    const loaded = await load();
    p.savePref("view", loaded.view);
    p.savePref("layout", { ...loaded.layout });
    p.savePref("settings", { ...loaded.settings });
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS * 2);
    await p.flushPrefs();
    expect(mock.sync.setCalls).toHaveLength(0);
  });

  it("skips a value equal to the last one written", async () => {
    await load();
    p.savePref("view", view({ hideBots: true }));
    await p.flushPrefs();
    expect(mock.sync.setCalls).toHaveLength(1);
    p.savePref("view", view({ hideBots: true }));
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS * 2);
    await p.flushPrefs();
    expect(mock.sync.setCalls).toHaveLength(1);
  });

  it("skips a value that only differs from the stored one before sanitising", async () => {
    await load();
    p.savePref("view", { ...view(), mystery: 1, kinds: [...p.RAIL_KIND_IDS, "unstar"] } as never);
    await p.flushPrefs();
    expect(mock.sync.setCalls).toHaveLength(0);
  });

  it("writes nothing when the user changes a value and changes it back before the debounce fires", async () => {
    await load();
    p.savePref("view", view({ period: "7" }));
    await vi.advanceTimersByTimeAsync(100);
    p.savePref("view", view());
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS * 2);
    await p.flushPrefs();
    expect(mock.sync.setCalls).toHaveLength(0);
  });

  it("still writes a value equal to the stored one when a different write is in flight (the in-flight write would otherwise win)", async () => {
    await load();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realSet = mock.sync.set;
    vi.spyOn(mock.sync, "set").mockImplementationOnce(async (items) => {
      await gate;
      return realSet(items);
    });
    p.savePref("view", view({ period: "7" }));
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS); // write of "7" is now in flight, sync still holds the default
    p.savePref("view", view()); // user goes back to the default; sync (as far as anyone knows yet) already holds it
    release();
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS);
    await p.flushPrefs();
    expect(mock.sync.dump().view).toEqual(view());
  });

  it("writes again for a new value after an earlier write", async () => {
    await load();
    p.savePref("view", view({ period: "7" }));
    await p.flushPrefs();
    p.savePref("view", view({ period: "90" }));
    await p.flushPrefs();
    p.savePref("view", view({ period: "7" }));
    await p.flushPrefs();
    expect(mock.sync.setCalls.map((c) => (c.view as { period: string }).period)).toEqual(["7", "90", "7"]);
  });
});

describe("flushPrefs and installFlushOnHide", () => {
  it("writes debounced values immediately and resolves after the write completed", async () => {
    await load();
    p.savePref("view", view({ period: "7" }));
    p.savePref("layout", layout({ allRepos: true }));
    expect(mock.sync.setCalls).toHaveLength(0);
    await p.flushPrefs();
    expect(mock.sync.dump().view).toEqual(view({ period: "7" }));
    expect(mock.sync.dump().layout).toEqual(layout({ allRepos: true }));
    // The timers are gone: nothing is written twice.
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS * 3);
    expect(mock.sync.setCalls).toHaveLength(2);
  });

  it("is safe to call with nothing to do, and repeatedly", async () => {
    await load();
    await expect(p.flushPrefs()).resolves.toBeUndefined();
    p.savePref("view", view({ period: "7" }));
    await Promise.all([p.flushPrefs(), p.flushPrefs()]);
    await p.flushPrefs();
    expect(mock.sync.setCalls).toHaveLength(1);
  });

  it("waits for a write that is already in progress", async () => {
    await load();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realSet = mock.sync.set;
    vi.spyOn(mock.sync, "set").mockImplementationOnce(async (items) => {
      await gate;
      return realSet(items);
    });
    p.savePref("view", view({ period: "7" }));
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS);
    let done = false;
    void p.flushPrefs().then(() => (done = true));
    await mock.settle();
    expect(done).toBe(false);
    release();
    await p.flushPrefs();
    expect(done).toBe(true);
    expect(mock.sync.dump().view).toEqual(view({ period: "7" }));
  });

  describe("installFlushOnHide", () => {
    function stubPage() {
      const win = new EventTarget();
      const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
      const winAdd = vi.spyOn(win, "addEventListener");
      const docAdd = vi.spyOn(doc, "addEventListener");
      vi.stubGlobal("window", win);
      vi.stubGlobal("document", doc);
      return { win, doc, winAdd, docAdd };
    }

    it("flushes on pagehide", async () => {
      const { win } = stubPage();
      await load();
      p.installFlushOnHide();
      p.savePref("view", view({ period: "7" }));
      win.dispatchEvent(new Event("pagehide"));
      expect(mock.sync.setCalls).toHaveLength(1); // the chrome.storage call was made synchronously
      await p.flushPrefs();
      expect(mock.sync.dump().view).toEqual(view({ period: "7" }));
    });

    it("flushes on visibilitychange to hidden, not to visible", async () => {
      const { doc } = stubPage();
      await load();
      p.installFlushOnHide();
      p.savePref("view", view({ period: "7" }));
      doc.dispatchEvent(new Event("visibilitychange"));
      expect(mock.sync.setCalls).toHaveLength(0);
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
      expect(mock.sync.setCalls).toHaveLength(1);
    });

    it("guards against double install", () => {
      const { winAdd, docAdd } = stubPage();
      p.installFlushOnHide();
      p.installFlushOnHide();
      p.installFlushOnHide();
      expect(winAdd).toHaveBeenCalledTimes(1);
      expect(docAdd).toHaveBeenCalledTimes(1);
    });

    it("does nothing outside a page", () => {
      expect(() => p.installFlushOnHide()).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("onPrefsChange: echo filtering", () => {
  it("does not deliver this context's own writes", async () => {
    await load();
    const cb = vi.fn();
    p.onPrefsChange(cb);
    p.savePref("view", view({ period: "7" }));
    p.savePref("layout", layout({ allKinds: true }));
    p.savePref("settings", { ...p.DEFAULT_SETTINGS, theme: "dark" });
    await p.flushPrefs();
    await mock.settle();
    expect(mock.sync.setCalls).toHaveLength(3);
    expect(cb).not.toHaveBeenCalled();
  });

  it("does not deliver the echo of the migration write", async () => {
    mock.sync.seed({ settings: { theme: "dark", showOwn: false } });
    const cb = vi.fn();
    p.onPrefsChange(cb);
    await p.loadPrefs();
    await mock.settle();
    expect(cb).not.toHaveBeenCalled();
  });

  it("delivers a foreign write, sanitised", async () => {
    await load();
    const cb = vi.fn();
    p.onPrefsChange(cb);
    await chrome.storage.sync.set({ view: { ...view({ period: "7" }), kinds: ["pr", "unstar"], mystery: 1 } });
    await mock.settle();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("view", view({ period: "7", kinds: ["pr"] }));
  });

  it("delivers foreign writes to each key, including settings written by the service worker", async () => {
    await load();
    const cb = vi.fn();
    p.onPrefsChange(cb);
    const owners = [{ login: "me", type: "user", on: true }];
    await chrome.storage.sync.set({ settings: { ...p.DEFAULT_SETTINGS, username: "me", owners } });
    await chrome.storage.sync.set({ layout: layout({ trendClosed: ["star"] }) });
    await mock.settle();
    expect(cb.mock.calls.map((c) => c[0]).toSorted()).toEqual(["layout", "settings"]);
    expect(cb).toHaveBeenCalledWith("settings", { ...p.DEFAULT_SETTINGS, username: "me", owners });
  });

  it("does not deliver a foreign write that sanitises to what this context already holds", async () => {
    await load();
    const cb = vi.fn();
    p.onPrefsChange(cb);
    await chrome.storage.sync.set({ view: { ...view(), someFutureField: true } });
    await mock.settle();
    expect(cb).not.toHaveBeenCalled();
  });

  it("delivers garbage as defaults when that differs from what the context holds, and removal as defaults", async () => {
    await load();
    p.savePref("view", view({ period: "7" }));
    p.savePref("layout", layout({ allKinds: true }));
    await p.flushPrefs();
    await mock.settle();
    const cb = vi.fn();
    p.onPrefsChange(cb);
    await chrome.storage.sync.set({ view: "garbage" });
    await chrome.storage.sync.remove("layout");
    await mock.settle();
    expect(cb).toHaveBeenCalledWith("view", p.DEFAULT_VIEW);
    expect(cb).toHaveBeenCalledWith("layout", p.DEFAULT_LAYOUT);
  });

  it("ignores other keys and the local area", async () => {
    await load();
    const cb = vi.fn();
    p.onPrefsChange(cb);
    await chrome.storage.sync.set({ schema: 5, other: 1 });
    await chrome.storage.local.set({ view: { period: "7" }, "pending:view": { period: "all" } });
    await mock.settle();
    expect(cb).not.toHaveBeenCalled();
  });

  it("applies what it was told: a later own save of the delivered value writes nothing", async () => {
    await load();
    p.onPrefsChange(() => {});
    await chrome.storage.sync.set({ view: view({ period: "90" }) });
    await mock.settle();
    p.savePref("view", view({ period: "90" }));
    await p.flushPrefs();
    expect(mock.sync.setCalls).toHaveLength(1); // only the foreign one
  });

  it("delivers a foreign change once to every subscriber", async () => {
    await load();
    const a = vi.fn();
    const b = vi.fn();
    p.onPrefsChange(a);
    p.onPrefsChange(b);
    await chrome.storage.sync.set({ view: view({ period: "7" }) });
    await mock.settle();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe, and one throwing callback does not block the others", async () => {
    await load();
    const quiet = vi.fn();
    const loud = vi.fn(() => {
      throw new Error("callback bug");
    });
    const last = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const offQuiet = p.onPrefsChange(quiet);
    p.onPrefsChange(loud);
    p.onPrefsChange(last);
    offQuiet();
    await chrome.storage.sync.set({ view: view({ period: "7" }) });
    await mock.settle();
    expect(quiet).not.toHaveBeenCalled();
    expect(loud).toHaveBeenCalledTimes(1);
    expect(last).toHaveBeenCalledTimes(1);
  });

  it("across two pages: the writer gets no echo, the other page gets the change", async () => {
    const pageA = p;
    const pageB = await freshModule();
    await load(pageA);
    await load(pageB);
    const cbA = vi.fn();
    const cbB = vi.fn();
    pageA.onPrefsChange(cbA);
    pageB.onPrefsChange(cbB);
    pageA.savePref("view", view({ hideMe: true }));
    await pageA.flushPrefs();
    await mock.settle();
    expect(cbA).not.toHaveBeenCalled();
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledWith("view", view({ hideMe: true }));
    // And it does not bounce back: B holds the value now, so saving it is a no-op.
    pageB.savePref("view", view({ hideMe: true }));
    await pageB.flushPrefs();
    await mock.settle();
    expect(mock.sync.setCalls).toHaveLength(1);
    expect(cbA).not.toHaveBeenCalled();
  });

  it("does not apply a foreign change over a local edit that is still waiting for its debounce", async () => {
    await load();
    const cb = vi.fn();
    p.onPrefsChange(cb);
    p.savePref("view", view({ period: "7" }));
    await chrome.storage.sync.set({ view: view({ period: "365" }) });
    await mock.settle();
    expect(cb).not.toHaveBeenCalled();
    await p.flushPrefs();
    await mock.settle();
    expect(mock.sync.dump().view).toEqual(view({ period: "7" })); // last writer wins, and the page keeps showing it
    expect(cb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("size limits", () => {
  const longRepos = (n: number) => Array.from({ length: n }, (_, i) => `owner-${String(i).padStart(3, "0")}/${"x".repeat(80)}`);

  it("drops the oldest repo selections until view fits in MAX_ITEM_BYTES", async () => {
    await load();
    const repos = longRepos(100);
    expect(bytes("view", view({ repos }))).toBeGreaterThan(p.MAX_ITEM_BYTES);
    p.savePref("view", view({ repos }));
    await p.flushPrefs();
    const stored = mock.sync.dump().view as { repos: string[] };
    expect(bytes("view", stored)).toBeLessThanOrEqual(p.MAX_ITEM_BYTES);
    expect(stored.repos.length).toBeLessThan(100);
    expect(stored.repos.length).toBeGreaterThan(50);
    expect(stored.repos).toEqual(repos.slice(repos.length - stored.repos.length)); // the most recent ones survive, in order
    // As many as fit: one more would have exceeded the limit.
    expect(bytes("view", view({ repos: repos.slice(repos.length - stored.repos.length - 1) }))).toBeGreaterThan(p.MAX_ITEM_BYTES);
    // Nothing else in the view was touched.
    expect({ ...stored, repos: [] }).toEqual(view());
  });

  it("leaves a view that fits alone", async () => {
    await load();
    const repos = Array.from({ length: 100 }, (_, i) => `o/r${i}`);
    p.savePref("view", view({ repos }));
    await p.flushPrefs();
    expect((mock.sync.dump().view as { repos: string[] }).repos).toEqual(repos);
  });

  it("caps at MAX_REPOS before the byte limit applies", async () => {
    await load();
    p.savePref("view", { ...view(), repos: Array.from({ length: 130 }, (_, i) => `o/r${i}`) });
    await p.flushPrefs();
    const stored = mock.sync.dump().view as { repos: string[] };
    expect(stored.repos).toHaveLength(100);
    expect(stored.repos[0]).toBe("o/r30");
  });

  it("does not report the trimmed selection as a foreign change", async () => {
    await load();
    const cb = vi.fn();
    p.onPrefsChange(cb);
    p.savePref("view", view({ repos: longRepos(100) }));
    await p.flushPrefs();
    await mock.settle();
    expect(cb).not.toHaveBeenCalled();
  });

  it("just attempts other keys: an oversized settings value is rejected by the quota and kept as pending", async () => {
    await load();
    const owners = Array.from({ length: 300 }, (_, i) => ({ login: `owner-with-a-long-name-${i}`, type: "org" as const, on: true }));
    const settings = { ...p.DEFAULT_SETTINGS, owners };
    expect(bytes("settings", settings)).toBeGreaterThan(8192);
    p.savePref("settings", settings);
    await p.flushPrefs();
    expect(mock.sync.setCalls).toHaveLength(1);
    expect(mock.sync.dump().settings).toEqual(p.DEFAULT_SETTINGS); // unchanged
    expect((mock.local.dump()["pending:settings"] as { owners: unknown[] }).owners).toHaveLength(300);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("failed sync writes and pending:<key>", () => {
  it("keeps a failed write in local pending:<key> and leaves sync alone", async () => {
    await load();
    mock.failNextSyncSet();
    p.savePref("view", view({ period: "7" }));
    await p.flushPrefs();
    expect(mock.sync.dump().view).toEqual(view());
    expect(mock.local.dump()["pending:view"]).toEqual(view({ period: "7" }));
  });

  it("treats chrome.runtime.lastError as a failure too", async () => {
    await load();
    mock.failNextSyncSet({ lastError: true, message: "Quota exceeded" });
    p.savePref("layout", layout({ allKinds: true }));
    await p.flushPrefs();
    expect(mock.local.dump()["pending:layout"]).toEqual(layout({ allKinds: true }));
  });

  it("does not lose the change when the quota rejects it", async () => {
    mock = installChromeMock({ syncQuotaPerItem: 100 });
    p = await freshModule();
    await load();
    p.savePref("view", view({ period: "7" })); // > 100 bytes
    await p.flushPrefs();
    expect(mock.local.dump()["pending:view"]).toEqual(view({ period: "7" }));
  });

  it("retries on the next save of that key, writes the newer value and clears pending", async () => {
    await load();
    mock.failNextSyncSet();
    p.savePref("view", view({ period: "7" }));
    await p.flushPrefs();
    p.savePref("view", view({ period: "90" }));
    await p.flushPrefs();
    expect(mock.sync.dump().view).toEqual(view({ period: "90" }));
    expect(mock.local.dump()).not.toHaveProperty("pending:view");
  });

  it("retries even when the next save has the same value (it is not skipped as 'unchanged')", async () => {
    await load();
    mock.failNextSyncSet();
    p.savePref("view", view({ period: "7" }));
    await p.flushPrefs();
    p.savePref("view", view({ period: "7" }));
    await p.flushPrefs();
    expect(mock.sync.dump().view).toEqual(view({ period: "7" }));
    expect(mock.local.dump()).not.toHaveProperty("pending:view");
  });

  it("clears pending without a write when the user goes back to what sync already holds", async () => {
    await load();
    mock.failNextSyncSet();
    p.savePref("view", view({ period: "7" }));
    await p.flushPrefs();
    mock.sync.setCalls.length = 0;
    p.savePref("view", view());
    await p.flushPrefs();
    expect(mock.sync.setCalls).toHaveLength(0);
    expect(mock.local.dump()).not.toHaveProperty("pending:view");
  });

  it("keeps working after a failure: later debounced saves go to sync as usual", async () => {
    await load();
    mock.failNextSyncSet();
    p.savePref("view", view({ period: "7" }));
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS);
    p.savePref("layout", layout({ allKinds: true }));
    await vi.advanceTimersByTimeAsync(p.DEBOUNCE_MS);
    await p.flushPrefs();
    expect(mock.sync.dump().layout).toEqual(layout({ allKinds: true }));
    expect(mock.local.dump()["pending:view"]).toEqual(view({ period: "7" }));
    expect(mock.local.dump()).not.toHaveProperty("pending:layout");
  });

  it("loadPrefs on the next page load returns the pending value, pushes it to sync and clears it", async () => {
    await load();
    mock.failNextSyncSet();
    p.savePref("view", view({ period: "7", hideBots: true }));
    await p.flushPrefs();
    p = await freshModule();
    const prefs = await p.loadPrefs();
    expect(prefs.view).toEqual(view({ period: "7", hideBots: true }));
    expect(mock.sync.dump().view).toEqual(view({ period: "7", hideBots: true }));
    expect(mock.local.dump()).not.toHaveProperty("pending:view");
  });

  it("loadPrefs keeps pending when the retry fails again", async () => {
    await load();
    mock.failNextSyncSet();
    p.savePref("view", view({ period: "7" }));
    await p.flushPrefs();
    p = await freshModule();
    mock.failNextSyncSet();
    const prefs = await p.loadPrefs();
    expect(prefs.view).toEqual(view({ period: "7" }));
    expect(mock.sync.dump().view).toEqual(view());
    expect(mock.local.dump()["pending:view"]).toEqual(view({ period: "7" }));
  });

  it("a pending value wins over a different synced one on load", async () => {
    mock.sync.seed({ view: view({ period: "90" }), layout: layout(), settings: p.DEFAULT_SETTINGS, schema: 2 });
    mock.local.seed({ "pending:view": view({ period: "7" }), "pending:layout": layout({ allKinds: true }) });
    const prefs = await p.loadPrefs();
    expect(prefs.view.period).toBe("7");
    expect(prefs.layout.allKinds).toBe(true);
    expect(prefs.settings).toEqual(p.DEFAULT_SETTINGS);
  });

  it("sanitises a pending value", async () => {
    mock.sync.seed({ view: view(), layout: layout(), settings: p.DEFAULT_SETTINGS, schema: 2 });
    mock.local.seed({ "pending:view": { period: "bogus", hideMe: true, kinds: ["pr", "unstar"], mystery: 1 } });
    const prefs = await p.loadPrefs();
    expect(prefs.view).toEqual(view({ hideMe: true, kinds: ["pr"] }));
    expect(mock.sync.dump().view).toEqual(view({ hideMe: true, kinds: ["pr"] }));
  });

  it("drops a pending value that sync already holds, without writing", async () => {
    mock.sync.seed({ view: view({ period: "7" }), layout: layout(), settings: p.DEFAULT_SETTINGS, schema: 2 });
    mock.local.seed({ "pending:view": view({ period: "7" }) });
    await p.loadPrefs();
    expect(mock.sync.setCalls).toHaveLength(0);
    expect(mock.local.dump()).not.toHaveProperty("pending:view");
  });

  it("the page ends up consistent: a pending load does not echo back to the loading page", async () => {
    mock.sync.seed({ view: view({ period: "90" }), layout: layout(), settings: p.DEFAULT_SETTINGS, schema: 2 });
    mock.local.seed({ "pending:view": view({ period: "7" }) });
    const cb = vi.fn();
    p.onPrefsChange(cb);
    await p.loadPrefs();
    await mock.settle();
    expect(cb).not.toHaveBeenCalled();
  });

  it("a remote change that the page applied replaces a stale pending value", async () => {
    await load();
    p.onPrefsChange(() => {});
    mock.failNextSyncSet();
    p.savePref("view", view({ period: "7" }));
    await p.flushPrefs();
    await chrome.storage.sync.set({ view: view({ period: "365" }) });
    await mock.settle();
    expect(mock.local.dump()).not.toHaveProperty("pending:view");
    p = await freshModule();
    expect((await p.loadPrefs()).view.period).toBe("365");
  });
});
