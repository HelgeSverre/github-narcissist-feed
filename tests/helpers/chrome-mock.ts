/**
 * In-memory `chrome.storage` for unit tests (sync + local areas, onChanged, per-item quota, forced failures).
 *
 *   const mock = installChromeMock();
 *   await chrome.storage.sync.set({ view: {...} });
 *   mock.failNextSyncSet();
 *
 * Behaviour that matters to prefs.ts and mirrors Chrome:
 *  - get/set/remove are promise based and store JSON copies, so callers never share references with storage;
 *  - onChanged fires asynchronously (microtask) to every listener, with {oldValue,newValue} per key, and only for keys whose value changed;
 *  - the sync area rejects a set when an item's JSON length plus its key length exceeds the per-item quota (8192 by default).
 */

type Items = Record<string, unknown>;
export type StorageChange = { oldValue?: unknown; newValue?: unknown };
export type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void;

export const SYNC_QUOTA_BYTES_PER_ITEM = 8192;

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const byteLength = (s: string) => new TextEncoder().encode(s).length;

export interface FailOptions {
  /** Resolve normally but leave chrome.runtime.lastError set, as callback-style failures do. Default: reject. */
  lastError?: boolean;
  message?: string;
}

class MockOnChanged {
  readonly listeners = new Set<ChangeListener>();
  addListener = (fn: ChangeListener) => void this.listeners.add(fn);
  removeListener = (fn: ChangeListener) => void this.listeners.delete(fn);
  hasListener = (fn: ChangeListener) => this.listeners.has(fn);
  dispatch(changes: Record<string, StorageChange>, area: string) {
    // Asynchronous, like Chrome: never inside the call that caused it. Microtask, so fake timers do not hold it back.
    void Promise.resolve().then(() => {
      for (const fn of [...this.listeners]) {
        try {
          fn(changes, area);
        } catch (e) {
          console.error("[chrome-mock] onChanged listener threw", e);
        }
      }
    });
  }
}

export class MockArea {
  private data = new Map<string, unknown>();
  /** Every set() attempt, successful or not, as deep copies. */
  setCalls: Items[] = [];
  /** Every remove() attempt. */
  removeCalls: string[][] = [];
  private failure: FailOptions | null = null;

  constructor(
    readonly name: "sync" | "local",
    private readonly onChanged: MockOnChanged,
    private readonly runtime: { lastError?: { message: string } },
    private readonly quotaPerItem: number | null,
  ) {}

  /** Put data in without firing events or recording a call (test setup). */
  seed(items: Items) {
    for (const [k, v] of Object.entries(items)) if (v !== undefined) this.data.set(k, clone(v));
  }
  /** Snapshot of everything stored. */
  dump(): Items {
    return Object.fromEntries([...this.data].map(([k, v]) => [k, clone(v)]));
  }
  failNextSet(opts: FailOptions = {}) {
    this.failure = opts;
  }

  get = async (keys?: string | string[] | Items | null): Promise<Items> => {
    this.runtime.lastError = undefined;
    const out: Items = {};
    if (keys == null) {
      for (const [k, v] of this.data) out[k] = clone(v);
    } else if (typeof keys === "string" || Array.isArray(keys)) {
      for (const k of typeof keys === "string" ? [keys] : keys) if (this.data.has(k)) out[k] = clone(this.data.get(k));
    } else {
      for (const [k, d] of Object.entries(keys)) out[k] = this.data.has(k) ? clone(this.data.get(k)) : clone(d);
    }
    return out;
  };

  set = async (items: Items): Promise<void> => {
    this.runtime.lastError = undefined;
    this.setCalls.push(clone(items));
    if (this.failure) {
      const { lastError, message = "mock: forced storage failure" } = this.failure;
      this.failure = null;
      if (lastError) {
        this.runtime.lastError = { message };
        return;
      }
      throw new Error(message);
    }
    const next = new Map<string, unknown>();
    for (const [k, v] of Object.entries(items)) {
      if (v === undefined) continue;
      const stored = clone(v);
      if (this.quotaPerItem !== null && byteLength(JSON.stringify(stored)) + k.length > this.quotaPerItem) {
        throw new Error(`QUOTA_BYTES_PER_ITEM quota exceeded (${k})`);
      }
      next.set(k, stored);
    }
    const changes: Record<string, StorageChange> = {};
    for (const [k, v] of next) {
      const had = this.data.has(k);
      const old = this.data.get(k);
      if (had && JSON.stringify(old) === JSON.stringify(v)) continue;
      changes[k] = had ? { oldValue: clone(old), newValue: clone(v) } : { newValue: clone(v) };
      this.data.set(k, v);
    }
    if (Object.keys(changes).length) this.onChanged.dispatch(changes, this.name);
  };

  remove = async (keys: string | string[]): Promise<void> => {
    this.runtime.lastError = undefined;
    const list = typeof keys === "string" ? [keys] : keys;
    this.removeCalls.push([...list]);
    const changes: Record<string, StorageChange> = {};
    for (const k of list) {
      if (!this.data.has(k)) continue;
      changes[k] = { oldValue: clone(this.data.get(k)) };
      this.data.delete(k);
    }
    if (Object.keys(changes).length) this.onChanged.dispatch(changes, this.name);
  };
}

export interface ChromeMock {
  /** What gets installed as globalThis.chrome. */
  chrome: {
    storage: { sync: MockArea; local: MockArea; onChanged: MockOnChanged };
    runtime: { lastError?: { message: string } };
  };
  sync: MockArea;
  local: MockArea;
  onChanged: MockOnChanged;
  /** Make the next chrome.storage.sync.set fail (reject by default, or resolve with runtime.lastError set). */
  failNextSyncSet(opts?: FailOptions): void;
  /** Let queued onChanged dispatches (microtasks) run. */
  settle(): Promise<void>;
}

export function createChromeMock(opts: { syncQuotaPerItem?: number | null } = {}): ChromeMock {
  const onChanged = new MockOnChanged();
  const runtime: { lastError?: { message: string } } = {};
  const quota = opts.syncQuotaPerItem === undefined ? SYNC_QUOTA_BYTES_PER_ITEM : opts.syncQuotaPerItem;
  const sync = new MockArea("sync", onChanged, runtime, quota);
  const local = new MockArea("local", onChanged, runtime, null);
  return {
    chrome: { storage: { sync, local, onChanged }, runtime },
    sync,
    local,
    onChanged,
    failNextSyncSet: (o) => sync.failNextSet(o),
    settle: async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

/** Create a mock and install it as `globalThis.chrome`. Call in beforeEach so every test starts empty. */
export function installChromeMock(opts?: { syncQuotaPerItem?: number | null }): ChromeMock {
  const mock = createChromeMock(opts);
  (globalThis as unknown as { chrome: unknown }).chrome = mock.chrome;
  return mock;
}

export function uninstallChromeMock(): void {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
}
