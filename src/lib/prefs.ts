/**
 * Synced preferences: settings, view filters and layout.
 * Spec: docs/specs/persistence-and-sync.md
 *
 * This module is the only code that touches chrome.storage.sync keys `view`, `layout`, `schema`
 * and chrome.storage.local keys `pending:*`, `ui` (legacy) and `device`.
 * (`settings` is also read and seeded by storage.ts for the service worker, through `sanitize` below.)
 *
 * CONTRACT: the exported names, types and signatures below are fixed. Implementations may change.
 */
import { DEFAULT_SETTINGS, type Group, type Kind, type OwnerConfig, type Period, type Settings, type StackScope } from "./types";

export const SCHEMA_VERSION = 2;

/** Rail activity kinds a user can toggle. `unstar`/`unfork` are never stored in prefs. */
export const RAIL_KIND_IDS: Kind[] = ["star", "fork", "issue", "pr", "comment", "review", "release"];
export type TrendKind = "star" | "fork" | "issue" | "pr";
export const TREND_KINDS: TrendKind[] = ["star", "fork", "issue", "pr"];
export const RAIL_SECTIONS = ["activity", "owners", "people", "period", "repositories"] as const;
export type RailSection = (typeof RAIL_SECTIONS)[number];

export const MAX_REPOS = 100;
/** Stay under chrome.storage.sync QUOTA_BYTES_PER_ITEM (8192) with headroom for the key. */
export const MAX_ITEM_BYTES = 8000;
export const DEBOUNCE_MS = 400;

export interface ViewPrefs {
  period: Period;
  group: Group;
  kinds: Kind[];
  hideMe: boolean;
  hideBots: boolean;
  /** "owner/name", most recently selected last, max MAX_REPOS */
  repos: string[];
}

export interface LayoutPrefs {
  railClosed: RailSection[];
  allKinds: boolean;
  allRepos: boolean;
  /** Always a full permutation of TREND_KINDS */
  trendOrder: TrendKind[];
  trendClosed: TrendKind[];
}

export interface Prefs {
  settings: Settings;
  view: ViewPrefs;
  layout: LayoutPrefs;
}

export type PrefKey = keyof Prefs;

export const DEFAULT_VIEW: ViewPrefs = {
  period: "30",
  group: "day",
  kinds: [...RAIL_KIND_IDS],
  hideMe: false,
  hideBots: false,
  repos: [],
};

export const DEFAULT_LAYOUT: LayoutPrefs = {
  railClosed: [],
  allKinds: false,
  allRepos: false,
  trendOrder: [...TREND_KINDS],
  trendClosed: [],
};

export { DEFAULT_SETTINGS };

// ---------------------------------------------------------------------------------------------------------------------
// Sanitiser
// ---------------------------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const PERIODS: readonly Period[] = ["today", "7", "30", "90", "180", "365", "all"];
const GROUPS: readonly Group[] = ["day", "week", "month"];
const STACK_SCOPES: readonly StackScope[] = ["repo", "org", "type"];
const REFRESH_MINUTES: readonly Settings["refreshMinutes"][] = [0, 5, 10, 30];
const DATE_FORMATS: readonly Settings["dateFormat"][] = ["system", "iso", "dmy", "mdy"];
const TIME_FORMATS: readonly Settings["timeFormat"][] = ["24", "12"];
const WEEK_STARTS: readonly Settings["weekStart"][] = [0, 1];
const THEMES: readonly Settings["theme"][] = ["system", "light", "dark"];
const DENSITIES: readonly Settings["density"][] = ["default", "compact"];
/** GitHub "owner/name": letters, digits, `.`, `_`, `-` on both sides. */
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
const isOneOf = <T>(v: unknown, allowed: readonly T[]): v is T => (allowed as readonly unknown[]).includes(v);
const oneOf = <T>(v: unknown, allowed: readonly T[], d: T): T => (isOneOf(v, allowed) ? v : d);
/** Valid members of `allowed`, in the order given, without duplicates. Anything that is not an array gives []. */
const members = <T>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => isOneOf(x, allowed)))] : [];

function sanitizeOwners(raw: unknown): OwnerConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const owners: OwnerConfig[] = [];
  for (const o of raw) {
    if (!isObj(o) || typeof o.login !== "string") continue;
    const login = o.login.trim();
    if (!login || seen.has(login.toLowerCase())) continue;
    seen.add(login.toLowerCase());
    owners.push({ login, type: o.type === "org" ? "org" : "user", on: bool(o.on, true) });
  }
  return owners;
}

function sanitizeSettings(raw: unknown): Settings {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    username: str(r.username, d.username),
    owners: sanitizeOwners(r.owners),
    includePrivate: bool(r.includePrivate, d.includePrivate),
    refreshMinutes: oneOf(r.refreshMinutes, REFRESH_MINUTES, d.refreshMinutes),
    showUnstars: bool(r.showUnstars, d.showUnstars),
    trends: bool(r.trends, d.trends),
    stack: bool(r.stack, d.stack),
    stackScope: oneOf(r.stackScope, STACK_SCOPES, d.stackScope),
    stackRepoWindow: num(r.stackRepoWindow, d.stackRepoWindow),
    stackOrgWindow: num(r.stackOrgWindow, d.stackOrgWindow),
    dateFormat: oneOf(r.dateFormat, DATE_FORMATS, d.dateFormat),
    timeFormat: oneOf(r.timeFormat, TIME_FORMATS, d.timeFormat),
    weekStart: oneOf(r.weekStart, WEEK_STARTS, d.weekStart),
    theme: oneOf(r.theme, THEMES, d.theme),
    density: oneOf(r.density, DENSITIES, d.density),
  };
}

function sanitizeKinds(raw: unknown): Kind[] {
  if (!Array.isArray(raw)) return [...RAIL_KIND_IDS];
  const kinds = members(raw, RAIL_KIND_IDS);
  // [] is a real choice ("show nothing"); a non-empty array with no valid entry is corruption, not a choice.
  return kinds.length || !raw.length ? kinds : [...RAIL_KIND_IDS];
}

function sanitizeRepos(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const repos = [...new Set(raw.filter((x): x is string => typeof x === "string" && REPO_RE.test(x)))];
  return repos.length > MAX_REPOS ? repos.slice(-MAX_REPOS) : repos;
}

function sanitizeView(raw: unknown): ViewPrefs {
  const r = isObj(raw) ? raw : {};
  return {
    period: oneOf(r.period, PERIODS, DEFAULT_VIEW.period),
    group: oneOf(r.group, GROUPS, DEFAULT_VIEW.group),
    kinds: sanitizeKinds(r.kinds),
    hideMe: bool(r.hideMe, DEFAULT_VIEW.hideMe),
    hideBots: bool(r.hideBots, DEFAULT_VIEW.hideBots),
    repos: sanitizeRepos(r.repos),
  };
}

function sanitizeLayout(raw: unknown): LayoutPrefs {
  const r = isObj(raw) ? raw : {};
  const trendOrder = members(r.trendOrder, TREND_KINDS);
  for (const k of TREND_KINDS) if (!trendOrder.includes(k)) trendOrder.push(k);
  return {
    railClosed: members(r.railClosed, RAIL_SECTIONS),
    allKinds: bool(r.allKinds, DEFAULT_LAYOUT.allKinds),
    allRepos: bool(r.allRepos, DEFAULT_LAYOUT.allRepos),
    trendOrder,
    trendClosed: members(r.trendClosed, TREND_KINDS),
  };
}

/** Return a fully valid value for `key` from anything read out of storage. Never throws. */
export function sanitize<K extends PrefKey>(key: K, raw: unknown): Prefs[K] {
  const run = (v: unknown): Prefs[PrefKey] =>
    key === "settings" ? sanitizeSettings(v) : key === "view" ? sanitizeView(v) : sanitizeLayout(v);
  try {
    return run(raw) as Prefs[K];
  } catch {
    // Only reachable for exotic input (throwing getters, revoked proxies).
    return run(undefined) as Prefs[K];
  }
}

/** True when `view` filters content differently from DEFAULT_VIEW (period and group are ignored). */
export function viewIsFiltered(view: ViewPrefs): boolean {
  const kinds = new Set(view.kinds);
  const allKinds = kinds.size === RAIL_KIND_IDS.length && RAIL_KIND_IDS.every((k) => kinds.has(k));
  return !allKinds || view.hideMe || view.hideBots || view.repos.length > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Storage plumbing
// ---------------------------------------------------------------------------------------------------------------------

const PREF_KEYS: readonly PrefKey[] = ["settings", "view", "layout"];
const SCHEMA_KEY = "schema";
const pendingKey = (key: PrefKey) => `pending:${key}`;
const encoder = new TextEncoder();
const json = (v: unknown) => JSON.stringify(v);

/** Size as Chrome counts it for QUOTA_BYTES_PER_ITEM: the JSON of the value plus the key. */
const itemBytes = (key: string, value: unknown) => encoder.encode(json(value)).length + key.length;

/** Trim `value` under MAX_ITEM_BYTES. Only `view.repos` can shrink (oldest selections go first); other keys are returned as is. */
function fit<K extends PrefKey>(key: K, value: Prefs[K]): Prefs[K] {
  if (key !== "view" || itemBytes(key, value) <= MAX_ITEM_BYTES) return value;
  const view = value as ViewPrefs;
  let repos = view.repos;
  while (repos.length && itemBytes(key, { ...view, repos }) > MAX_ITEM_BYTES) repos = repos.slice(1);
  return { ...view, repos } as Prefs[K];
}

/** chrome.storage.sync.set that also treats chrome.runtime.lastError as a failure. */
async function syncSet(items: Obj): Promise<void> {
  await chrome.storage.sync.set(items);
  const err = chrome.runtime?.lastError;
  if (err) throw new Error(err.message ?? "chrome.storage.sync.set failed");
}

async function safeGet(area: "sync" | "local", keys: string[]): Promise<Obj | null> {
  try {
    const r = await chrome.storage[area].get(keys);
    const err = chrome.runtime?.lastError;
    return err ? null : (r as Obj);
  } catch {
    return null;
  }
}

/** JSON of the value this context holds per key. Used to absorb echoes of our own writes. */
const known = new Map<PrefKey, string>();
/** JSON of what chrome.storage.sync is believed to contain per key. Used to skip redundant writes. */
const synced = new Map<PrefKey, string>();
/** Keys with a `pending:<key>` entry in chrome.storage.local (a sync write that failed and is waiting for a retry). */
const pendingKeys = new Set<PrefKey>();
/** Debounced writes that have not started yet. */
const queued = new Map<PrefKey, { value: Prefs[PrefKey]; timer: ReturnType<typeof setTimeout> }>();
/** Writes in progress, one chain per key so that they happen in order. */
const chains = new Map<PrefKey, Promise<void>>();
type ChangeCallback = Parameters<typeof onPrefsChange>[0];
const listeners = new Set<ChangeCallback>();
let storageListener: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | null = null;
let hideInstalled = false;

async function clearPending(key: PrefKey): Promise<void> {
  pendingKeys.delete(key);
  try {
    await chrome.storage.local.remove(pendingKey(key));
  } catch {
    /* nothing more can be done */
  }
}

async function storePending(key: PrefKey, value: unknown): Promise<void> {
  pendingKeys.add(key);
  try {
    await chrome.storage.local.set({ [pendingKey(key)]: value });
  } catch {
    /* local storage failed too; the value lives on in memory until the page closes */
  }
}

/** Write one value to sync, falling back to `pending:<key>`. Never rejects. */
/** Whether sync is known to carry `schema: SCHEMA_VERSION`. A fresh profile gets it with its first write. */
let schemaStamped = false;

async function commit(key: PrefKey, value: Prefs[PrefKey]): Promise<void> {
  try {
    const next = json(value);
    if (next === synced.get(key)) {
      // Sync already holds it (an earlier write landed, or the user changed their mind). Only a stale pending entry is left to remove.
      if (pendingKeys.has(key)) await clearPending(key);
      return;
    }
    try {
      await syncSet(schemaStamped ? { [key]: value } : { [key]: value, [SCHEMA_KEY]: SCHEMA_VERSION });
    } catch {
      await storePending(key, value);
      return;
    }
    schemaStamped = true;
    synced.set(key, next);
    await clearPending(key);
  } catch {
    /* never reject: callers fire and forget */
  }
}

function enqueue(key: PrefKey, value: Prefs[PrefKey]): Promise<void> {
  const prev = chains.get(key);
  // With no write in progress the chrome.storage call happens synchronously, which matters on pagehide.
  const next = prev ? prev.then(() => commit(key, value)) : commit(key, value);
  chains.set(key, next);
  void next.then(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
  return next;
}

function flushKey(key: PrefKey): void {
  const entry = queued.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  queued.delete(key);
  void enqueue(key, entry.value);
}

function handleChanged(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area !== "sync") return;
  for (const key of PREF_KEYS) {
    const change = changes[key];
    if (!change) continue;
    const value = sanitize(key, change.newValue);
    const next = json(value);
    synced.set(key, next);
    // A local edit still waiting for its debounce will overwrite this change (last writer wins); applying it now would flip the UI back and forth.
    if (queued.has(key) || next === known.get(key)) continue;
    known.set(key, next);
    if (pendingKeys.has(key)) void clearPending(key); // the page now shows the newer remote value; a stale pending one must not resurrect on load
    for (const cb of Array.from(listeners)) {
      try {
        cb(key, value);
      } catch (e) {
        console.error("[prefs] onPrefsChange callback failed", e);
      }
    }
  }
}

function ensureStorageListener(): void {
  if (storageListener) return;
  storageListener = handleChanged;
  chrome.storage.onChanged.addListener(storageListener);
}

// ---------------------------------------------------------------------------------------------------------------------
// Migration (schema 1 -> 2)
// ---------------------------------------------------------------------------------------------------------------------

/** Build the schema-2 values from schema-1 data. Keeps `view`/`layout` that another computer already wrote. */
function migrate(sync: Obj, ui: unknown): Prefs {
  const u = isObj(ui) ? ui : {};
  const old = isObj(sync.settings) ? sync.settings : {};
  // First valid value wins, so a garbage `ui.period` falls through to the settings default instead of to "30" directly.
  const period = [u.period, old.defaultPeriod].find((v): v is Period => isOneOf(v, PERIODS)) ?? DEFAULT_VIEW.period;
  const group = [u.group, old.defaultGroup].find((v): v is Group => isOneOf(v, GROUPS)) ?? DEFAULT_VIEW.group;
  const view =
    sync.view !== undefined
      ? sanitize("view", sync.view)
      : sanitize("view", {
          period,
          group,
          kinds: RAIL_KIND_IDS,
          hideMe: old.showOwn === false,
          hideBots: old.showBots === false,
          repos: [],
        });
  const layout =
    sync.layout !== undefined
      ? sanitize("layout", sync.layout)
      : sanitize("layout", {
          railClosed: u.collapsedRail,
          allKinds: u.allKinds,
          allRepos: false,
          trendOrder: u.trendOrder,
          trendClosed: u.trendClosed,
        });
  // sanitize() drops defaultPeriod / defaultGroup / showOwn / showBots from settings.
  return { settings: sanitize("settings", sync.settings), view, layout };
}

/** Move `lastOpenedAt` from the legacy local `ui` to `device`, then delete `ui`. */
async function retireLegacyUi(ui: unknown, device: unknown): Promise<void> {
  try {
    const lastOpenedAt = isObj(ui) && typeof ui.lastOpenedAt === "string" ? ui.lastOpenedAt : undefined;
    const current = isObj(device) ? device : {};
    if (lastOpenedAt && typeof current.lastOpenedAt !== "string") await chrome.storage.local.set({ device: { ...current, lastOpenedAt } });
    await chrome.storage.local.remove("ui");
  } catch {
    /* ui stays; the next load tries again */
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------------

/** Run the schema-1 → 2 migration if needed, then load and sanitise all synced prefs (pending local values win). */
export async function loadPrefs(): Promise<Prefs> {
  ensureStorageListener();
  const [s, l] = await Promise.all([
    safeGet("sync", [...PREF_KEYS, SCHEMA_KEY]),
    safeGet("local", ["ui", "device", ...PREF_KEYS.map(pendingKey)]),
  ]);
  const local = l ?? {};
  // If sync cannot be read at all, migrating would overwrite real data with defaults: don't.
  const schema = s && typeof s[SCHEMA_KEY] === "number" ? (s[SCHEMA_KEY] as number) : 0;
  // Only migrate when there is schema-1 data to migrate. On a brand-new computer, Chrome may not have delivered the
  // user's synced prefs yet; writing defaults now would overwrite them. Defaults stay in memory until the user changes
  // something, and synced data that arrives later is applied through onPrefsChange.
  const hasLegacy = local.ui !== undefined || (s !== null && s.settings !== undefined);
  const migrating = s !== null && schema < SCHEMA_VERSION && hasLegacy;

  const fromSync: Prefs = {
    settings: sanitize("settings", s?.settings),
    view: sanitize("view", s?.view),
    layout: sanitize("layout", s?.layout),
  };
  const current = migrating && s ? migrate(s, local.ui) : fromSync;
  const result: Prefs = { ...current };
  const toRetry: PrefKey[] = [];
  for (const key of PREF_KEYS) {
    const pending = local[pendingKey(key)];
    if (pending === undefined) continue;
    (result as Record<PrefKey, unknown>)[key] = fit(key, sanitize(key, pending));
    pendingKeys.add(key);
    toRetry.push(key);
  }
  // `known` is set before any write below so the echoes of those writes are recognised as ours.
  for (const key of PREF_KEYS) known.set(key, json(result[key]));

  let migrated = false;
  if (migrating) {
    try {
      await syncSet({ view: current.view, layout: current.layout, settings: current.settings, [SCHEMA_KEY]: SCHEMA_VERSION });
      migrated = true;
    } catch {
      /* `ui` stays, so the next load migrates again */
    }
  }
  if (schema >= SCHEMA_VERSION || migrated) schemaStamped = true;
  if (s !== null) for (const key of PREF_KEYS) synced.set(key, json(migrated ? current[key] : fromSync[key]));

  if (local.ui !== undefined && s !== null && (!migrating || migrated)) await retireLegacyUi(local.ui, local.device);

  for (const key of toRetry) void enqueue(key, result[key]);
  await Promise.all(chains.values());
  return result;
}

/**
 * Persist one key. Debounced DEBOUNCE_MS per key, coalesced, skipped when equal to the last written value,
 * trimmed to MAX_ITEM_BYTES, falls back to local `pending:<key>` when the sync write fails.
 * Returns immediately; use flushPrefs() to await.
 */
export function savePref<K extends PrefKey>(key: K, value: Prefs[K]): void {
  ensureStorageListener();
  const clean = fit(key, sanitize(key, value));
  known.set(key, json(clean));
  const waiting = queued.get(key);
  if (waiting) clearTimeout(waiting.timer);
  // Nothing to do when sync already holds this value. With a write in progress the answer is not known yet, so commit() decides later.
  if (json(clean) === synced.get(key) && !pendingKeys.has(key) && !chains.has(key)) {
    queued.delete(key);
    return;
  }
  queued.set(key, { value: clean, timer: setTimeout(() => flushKey(key), DEBOUNCE_MS) });
}

/** Write any debounced values now. Safe to call repeatedly. */
export async function flushPrefs(): Promise<void> {
  for (const key of Array.from(queued.keys())) flushKey(key);
  await Promise.all(chains.values());
}

/**
 * Subscribe to synced pref changes made elsewhere (other tabs, other computers, the service worker).
 * The callback receives a sanitised value. Changes equal to this context's last known value are not delivered.
 * Returns an unsubscribe function.
 */
export function onPrefsChange(cb: <K extends PrefKey>(key: K, value: Prefs[K]) => void): () => void {
  ensureStorageListener();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Register pagehide / visibilitychange listeners that call flushPrefs(). Call once from the page. */
export function installFlushOnHide(): void {
  if (hideInstalled || typeof window === "undefined" || typeof document === "undefined") return;
  hideInstalled = true;
  window.addEventListener("pagehide", () => void flushPrefs());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPrefs();
  });
}
