/** Browser-only adapter. Both storage areas are device-local IndexedDB on the website. */
import { createStore, getMany, setMany, delMany, keys as storedKeys } from "idb-keyval";
import type { Message } from "./lib/types";

type Changes = Record<string, chrome.storage.StorageChange>;
const listeners = new Set<(changes: Changes, area: string) => void>();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("narcissist-storage") : null;
const emit = (changes: Changes, area: string) => {
  for (const listener of listeners) listener(changes, area);
};
channel?.addEventListener("message", ({ data }) => emit(data.changes, data.area));
function storageArea(name: string) {
  const store = createStore(`narcissist-feed-${name}`, "values");
  return {
    async get(query: string | string[] | Record<string, unknown> | null = null) {
      const names =
        query === null
          ? (await storedKeys(store)).map(String)
          : typeof query === "string"
            ? [query]
            : Array.isArray(query)
              ? query
              : Object.keys(query);
      const values = await getMany(names, store);
      return Object.fromEntries(
        names.map((key, i) => [key, values[i] ?? (query && typeof query === "object" && !Array.isArray(query) ? query[key] : undefined)]),
      );
    },
    async set(items: Record<string, unknown>) {
      const names = Object.keys(items);
      const before = await getMany(names, store);
      await setMany(Object.entries(items), store);
      const changes = Object.fromEntries(names.map((key, i) => [key, { oldValue: before[i], newValue: items[key] }]));
      emit(changes, name);
      // BroadcastChannel messages are scoped to this origin and have no targetOrigin argument.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      channel?.postMessage({ changes, area: name });
    },
    async remove(query: string | string[]) {
      const names = typeof query === "string" ? [query] : query;
      const before = await getMany(names, store);
      await delMany(names, store);
      const changes = Object.fromEntries(names.map((key, i) => [key, { oldValue: before[i] }]));
      emit(changes, name);
      // BroadcastChannel messages are scoped to this origin and have no targetOrigin argument.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      channel?.postMessage({ changes, area: name });
    },
  };
}
const storage = {
  local: storageArea("local"),
  sync: storageArea("sync"),
  onChanged: {
    addListener: (fn: (changes: Changes, area: string) => void) => listeners.add(fn),
    removeListener: (fn: (changes: Changes, area: string) => void) => listeners.delete(fn),
  },
};
Object.assign(globalThis, { chrome: { storage, runtime: { sendMessage, getPlatformInfo: async () => ({}) } } });
const { refresh } = await import("./background/refresh");
const { validateToken, searchOwners, resolveOwner, loadPeople } = await import("./background/account");
const { getSettings, patchStatus, getStatus } = await import("./lib/storage");
const { sanitize } = await import("./lib/prefs");
async function sweep(mode: "quick" | "full") {
  if (!navigator.onLine) return;
  // Serialize across tabs and installed windows; a closed page automatically releases its lock.
  return navigator.locks.request("narcissist-refresh", { ifAvailable: mode === "quick" }, async (lock) => {
    if (!lock) return;
    await patchStatus({ refreshing: null, refreshingSince: undefined });
    return refresh(mode, "website");
  });
}
async function sendMessage(message: Message) {
  try {
    switch (message.type) {
      case "refresh":
        return await sweep(message.mode);
      case "validateToken":
        return await validateToken(message.token);
      case "searchOwners":
        return await searchOwners(message.q);
      case "resolveOwner":
        return await resolveOwner(message.login);
      case "loadPeople":
        return await loadPeople();
    }
  } catch (error) {
    return { error: (error as Error).message };
  }
}
storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token?.newValue) {
    void (async () => {
      await validateToken();
      await sweep("full");
    })().catch(console.error);
  }
  if (area === "sync" && changes.settings) {
    const before = sanitize("settings", changes.settings.oldValue);
    const after = sanitize("settings", changes.settings.newValue);
    if (
      before.includePrivate !== after.includePrivate ||
      after.owners.some((owner) => !before.owners.some((old) => old.login === owner.login))
    )
      void sweep("full").catch(console.error);
  }
});
async function refreshDue() {
  if (document.hidden || !navigator.onLine) return;
  const [settings, status] = await Promise.all([getSettings(), getStatus()]);
  if (settings.refreshMinutes === 0 || !settings.username) return;
  if (!status.lastFullAt || Date.now() - Date.parse(status.lastFullAt) >= 3600_000) await sweep("full");
  else if (
    settings.refreshMinutes > 0 &&
    (!status.lastQuickAt || Date.now() - Date.parse(status.lastQuickAt) >= settings.refreshMinutes * 60_000)
  )
    await sweep("quick");
}
const check = () => {
  void refreshDue().catch(console.error);
};
setInterval(check, 60_000);
window.addEventListener("online", check);
document.addEventListener("visibilitychange", check);
check();
