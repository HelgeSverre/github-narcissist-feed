# Persistence and sync

Status: approved for implementation · 2026-10-22

## Goal

Every filter, setting and layout choice survives a reload, a browser restart and an extension update, and follows the user to other computers signed into the same Chrome profile. Cached GitHub data and the token stay on the device.

## Classification

Each piece of state belongs to exactly one tier.

| Tier   | Storage                | Contents                                                                                                           | Why                                                                                                     |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Synced | `chrome.storage.sync`  | settings, view filters, layout                                                                                     | Should follow the user. Chrome stores it locally when Chrome sync is off, so no special case is needed. |
| Device | `chrome.storage.local` | token, events, ledger, owner metadata, people, status, device state                                                | Large, re-fetchable, or secret. The token is never synced.                                              |
| Tab    | memory only            | search text, repository filter text, collapsed day groups, expanded stacks, rows shown, open popover, current view | Transient. A new tab opening on yesterday's search would hide data; day-group keys go stale every day.  |

### Synced keys

Three keys, split by how often and from where they change, so concurrent edits on two computers rarely touch the same key. Conflict rule: last writer wins per key.

| Key        | Shape                                                        | Changes                                                 |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `settings` | `Settings` (existing, minus the four "default" fields below) | Rarely, from the Settings page                          |
| `view`     | `ViewPrefs`                                                  | Often, from the rail and toolbar                        |
| `layout`   | `LayoutPrefs`                                                | Occasionally, collapsing rail sections and trend panels |
| `schema`   | `number`                                                     | Once per migration                                      |

```ts
interface ViewPrefs {
  period: Period; // rail "Period"
  group: Group; // toolbar Day/Week/Month
  kinds: Kind[]; // rail "Activity" checkboxes (rail kinds only, never unstar/unfork)
  hideMe: boolean; // rail "Hide my own activity"
  hideBots: boolean; // rail "Hide bots"
  repos: string[]; // rail "Repositories" selection, "owner/name", max 100
}
interface LayoutPrefs {
  railClosed: string[]; // collapsed rail sections: "activity" | "owners" | "people" | "period" | "repositories"
  allKinds: boolean; // "Show all 7" in Activity
  allRepos: boolean; // "Show all N" in Repositories
  trendOrder: TrendKind[]; // permutation of ["star","fork","issue","pr"]
  trendClosed: TrendKind[];
}
```

Owner checkboxes stay where they are: `settings.owners[].on`.

### Removed settings

Persisted filters make these redundant. They are migrated, then deleted from `settings`:

| Old field       | Becomes                     |
| --------------- | --------------------------- |
| `defaultPeriod` | `view.period`               |
| `defaultGroup`  | `view.group`                |
| `showOwn`       | `view.hideMe = !showOwn`    |
| `showBots`      | `view.hideBots = !showBots` |

The four Settings rows go away. Settings gains a **Sync** section with "Reset filters" and "Reset layout".

## Chrome sync limits and how they are respected

| Limit    | Value                          | Handling                                                                                                                           |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Per item | 8,192 bytes                    | `view.repos` capped at 100 entries; if a serialised item still exceeds 8,000 bytes, drop the oldest repo selections until it fits. |
| Total    | 102,400 bytes                  | Three small keys; worst case well under 20 KB.                                                                                     |
| Writes   | 120 per minute, 1,800 per hour | Writes are debounced 400 ms per key and skipped when the JSON equals the last written value.                                       |

A failed sync write (quota, or `chrome.runtime.lastError`) must not lose the change: the value is written to `chrome.storage.local` under `pending:<key>` and retried on the next save of that key and on next load. On load, a pending value wins over the synced one.

## Data validation

Synced values can come from another device running an older or newer version. Every value read from storage passes through a sanitiser that returns a fully valid object: unknown fields dropped, wrong types replaced by defaults, enums checked against their allowed values, arrays deduplicated, `trendOrder` repaired into a full permutation. A garbage value never throws.

## Migration (schema 1 → 2)

Runs in `loadPrefs()` when `sync.schema` is missing or below 2 **and** there is schema-1 data (local `ui` or synced `settings`). A brand-new profile writes nothing on load: Chrome may not have delivered the user's synced prefs yet, and writing defaults would overwrite them. Defaults stay in memory until the user changes something; synced data that arrives later is applied live. Idempotent: running it twice, or on two computers at once, yields the same result.

1. Read local `ui` (`period`, `group`, `collapsedRail`, `allKinds`, `trendOrder`, `trendClosed`) and synced `settings`.
2. Build `view`: `period = ui.period ?? settings.defaultPeriod ?? "30"`, `group = ui.group ?? settings.defaultGroup ?? "day"`, `hideMe = settings.showOwn === false`, `hideBots = settings.showBots === false`, all rail kinds, no repos.
3. Build `layout`: `railClosed = ui.collapsedRail`, `allKinds = ui.allKinds`, `trendOrder`, `trendClosed`, `allRepos = false`.
4. If `sync.view` or `sync.layout` already exist (another computer migrated first), keep them instead.
5. Write `view`, `layout`, `settings` without the four removed fields, and `schema: 2` in one `sync.set`.
6. Remove `ui` from local, keeping `lastOpenedAt` as local `device`.

## Live updates

`chrome.storage.onChanged` (area `sync`) delivers changes from other tabs and other computers. Open tabs apply them immediately. A tab ignores a change whose new value equals what it already holds, which also absorbs the echo of its own writes. The page flushes pending debounced writes on `pagehide` and `visibilitychange → hidden`.

## UI changes

- Rail, Repositories: selected repositories always appear at the top of the list, even with zero events in the period, so a persisted selection can always be seen and cleared.
- Settings → Sync section: "Settings, filters and layout follow your Chrome profile when Chrome sync is on. The token and cached activity stay on this computer." Buttons: Reset filters, Reset layout.
- Settings → Feed: remove Default period, Default grouping, Show my own activity, Show bot activity.

## Module contract

`src/lib/prefs.ts` owns all synced state. Nothing else reads or writes `sync.view`, `sync.layout`, `sync.schema` or local `pending:*`. The exported API is fixed in the file's type signatures.

## Verification

- Unit (Vitest, in-memory `chrome.storage` mock with per-item quota): defaults, sanitiser on garbage, migration from realistic schema-1 data, migration idempotence and "other device migrated first", debounce coalescing, equal-value skip, echo filtering, size trimming, failed write → pending → retried.
- End-to-end (existing Chrome for Testing harness): change filters and layout, reload the page, assert they persisted; write `view` to `chrome.storage.sync` from the service worker to simulate another computer, assert the open page updates without reload; assert migration of a seeded schema-1 profile.

## Out of scope

Syncing the token, export/import of settings as a file, per-device overrides.
