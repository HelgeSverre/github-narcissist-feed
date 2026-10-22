/**
 * Service worker entry point (manifest `background.service_worker`). Event wiring only: the work lives in
 * account.ts (token, owners, people), refresh.ts (the sweep) and ledger.ts (pure event/ledger logic).
 * Listeners must be registered synchronously at the top level, so everything below runs at module load.
 */
import { KEYS, getSettings, getStatus, patchStatus } from "../lib/storage";
import { sanitize } from "../lib/prefs";
import type { Message, Settings } from "../lib/types";
import { loadPeople, resolveOwner, searchOwners, validateToken } from "./account";
import { REFRESH_LOCK_MS, refresh } from "./refresh";

// A worker that was killed mid-refresh leaves `refreshing` set; clear it whenever the worker boots.
void clearStaleRefresh();
async function clearStaleRefresh() {
  const s = await getStatus();
  if (s.refreshing && (!s.refreshingSince || Date.now() - Date.parse(s.refreshingSince) > REFRESH_LOCK_MS))
    await patchStatus({ refreshing: null, refreshingSince: undefined });
}

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleAlarms();
  await refresh("full", "installed");
});
chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarms();
  await refresh("quick", "startup");
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "quick") await refresh("quick", "alarm");
  if (alarm.name === "full") await refresh("full", "alarm");
});
// Toolbar icon: focus the feed if it is already open in some window, otherwise open it in a new tab.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("index.html");
  const [open] = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB], documentUrls: [url] });
  if (open && open.tabId >= 0) {
    const tab = await chrome.tabs.update(open.tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && changes[KEYS.settings]) {
    // Merge with defaults so a first save (old value missing) does not look like a change.
    // Values can come from another computer running another version: sanitise before use.
    const before: Settings = sanitize("settings", changes[KEYS.settings].oldValue);
    const after: Settings = sanitize("settings", changes[KEYS.settings].newValue);
    if (before.refreshMinutes !== after.refreshMinutes) await scheduleAlarms();
    const had = new Set(before.owners.map((o) => o.login.toLowerCase()));
    const added = after.owners.filter((o) => !had.has(o.login.toLowerCase())).map((o) => o.login);
    // Seeding the viewer as the first owner happens inside validateToken, which already triggers a sweep.
    const seededViewer = added.length === 1 && !before.username && added[0].toLowerCase() === after.username.toLowerCase();
    if (before.includePrivate !== after.includePrivate) await refresh("full", "includePrivate changed");
    else if (added.length && !seededViewer) await refresh("full", `owners added (${added.join(", ")})`, added);
  }
  if (area === "local" && changes[KEYS.token] && changes[KEYS.token].newValue) {
    await validateToken();
    await refresh("full", "token changed");
  }
});
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "refresh":
          return sendResponse(await refresh(message.mode, "manual"));
        case "validateToken":
          return sendResponse(await validateToken(message.token));
        case "searchOwners":
          return sendResponse(await searchOwners(message.q));
        case "resolveOwner":
          return sendResponse(await resolveOwner(message.login));
        case "loadPeople":
          return sendResponse(await loadPeople());
      }
    } catch (e) {
      sendResponse({ error: (e as Error).message });
    }
  })();
  return true;
});

async function scheduleAlarms() {
  const s = await getSettings();
  await chrome.alarms.clear("quick");
  await chrome.alarms.clear("full");
  if (s.refreshMinutes > 0) await chrome.alarms.create("quick", { periodInMinutes: s.refreshMinutes });
  await chrome.alarms.create("full", { periodInMinutes: 60 });
}
