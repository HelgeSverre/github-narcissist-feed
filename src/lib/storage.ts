import { sanitize } from "./prefs";
import type { FeedEvent, OwnerMeta, Person, RepoLedger, Settings, Status } from "./types";

/**
 * Storage layout
 *  sync : settings            (follows the Chrome profile; read here, written by prefs.ts and by setSettings below)
 *         view, layout, schema (owned by prefs.ts; see docs/specs/persistence-and-sync.md)
 *  local: token               (never synced)
 *         events              (Record<id, FeedEvent>)
 *         owners              (Record<login, OwnerMeta>)
 *         people              (Person[] — orgs + following, for the owner picker)
 *         ledger              (Record<repo, RepoLedger>)
 *         status              (Status)
 *         device              (DeviceState)
 *         pending:*           (owned by prefs.ts: sync writes that failed and wait for a retry)
 */

export const KEYS = {
  settings: "settings",
  token: "token",
  events: "events",
  owners: "owners",
  people: "people",
  ledger: "ledger",
  status: "status",
  device: "device",
} as const;

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.sync.get(KEYS.settings);
  return sanitize("settings", r[KEYS.settings]);
}
/** Immediate, undebounced write (the service worker seeds owners with it). Use prefs.ts `savePref` from pages. */
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next = sanitize("settings", { ...cur, ...patch });
  await chrome.storage.sync.set({ [KEYS.settings]: next });
  return next;
}

export async function getToken(): Promise<string> {
  const r = await chrome.storage.local.get(KEYS.token);
  return (r[KEYS.token] as string) ?? "";
}
export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [KEYS.token]: token.trim() });
}

export async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T) ?? fallback;
}
export async function setLocal(obj: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(obj);
}

export const getEvents = () => getLocal<Record<string, FeedEvent>>(KEYS.events, {});
export const getOwners = () => getLocal<Record<string, OwnerMeta>>(KEYS.owners, {});
export const getPeople = () => getLocal<Person[]>(KEYS.people, []);
export const getLedger = () => getLocal<Record<string, RepoLedger>>(KEYS.ledger, {});
export const getStatus = () => getLocal<Status>(KEYS.status, {});

export async function patchStatus(patch: Partial<Status>): Promise<Status> {
  const cur = await getStatus();
  const next = { ...cur, ...patch };
  await setLocal({ [KEYS.status]: next });
  return next;
}

/** Subscribe to changes of specific keys in either area. Returns an unsubscribe function. */
export function onStorage(handler: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void): () => void {
  const fn = (changes: Record<string, chrome.storage.StorageChange>, area: string) => handler(changes, area);
  chrome.storage.onChanged.addListener(fn);
  return () => chrome.storage.onChanged.removeListener(fn);
}
