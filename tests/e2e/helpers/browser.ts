/**
 * Shared plumbing for the end-to-end suite: launch Chrome for Testing with the built extension, reach its service
 * worker, open extension pages that fail the test on errors, and read or drive the rail.
 *
 * Functions passed to `page.evaluate` / `worker.evaluate` run inside the browser. They are serialised as text, so they
 * must only use browser globals and their arguments, never imports or variables from this module.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, type Browser, type ElementHandle, type Page, type Target, type WebWorker } from "puppeteer-core";
import { expect, inject } from "vitest";
import type { LayoutPrefs, ViewPrefs } from "../../../src/lib/prefs";
import type { DeviceState, FeedEvent, OwnerMeta, Person, RepoLedger, Settings, Status } from "../../../src/lib/types";

export { fetchViewer, fineGrainedToken, githubToken, type GithubViewer } from "./tokens";

const VIEWPORT = { width: 1500, height: 1000 };
const SERVICE_WORKER_TIMEOUT = 20_000;
const ARTIFACT_DIR = join(process.cwd(), ".cache", "e2e-failures");

// ---------------------------------------------------------------------------------------------------------------------
// Browser, service worker, pages
// ---------------------------------------------------------------------------------------------------------------------

export interface OpenPageOptions {
  /** Selector that proves the app has booted. Defaults to the rail, which only renders once prefs and data are loaded. */
  ready?: string;
}

interface FinishedTask {
  name: string;
  result?: { state?: string };
}

/**
 * `chrome.storage.sync` as the extension lays it out (src/lib/prefs.ts, src/lib/storage.ts). Every key is optional: a
 * fresh profile holds none of them, and `view`, `layout` and `schema` only appear once the user changes something.
 */
export interface SyncStorage {
  settings?: Settings;
  view?: ViewPrefs;
  layout?: LayoutPrefs;
  schema?: number;
}

/** `chrome.storage.local` as the service worker lays it out (src/lib/storage.ts). Every key is absent until first written. */
export interface LocalStorage {
  token?: string;
  events?: Record<string, FeedEvent>;
  owners?: Record<string, OwnerMeta>;
  people?: Person[];
  ledger?: Record<string, RepoLedger>;
  status?: Status;
  device?: DeviceState;
}

/**
 * puppeteer types `WebWorker.evaluate` as `(...params: InnerParams<Params>) => ...`, which TypeScript cannot relate to a
 * caller-supplied generic `(...args: Args) => R`. This is the shape we actually use: the arguments are serialised as
 * given and the (awaited) result comes back as `R`.
 */
interface WorkerEvaluate {
  evaluate<Args extends unknown[], R>(fn: (...args: Args) => R, ...args: Args): Promise<Awaited<R>>;
}

const isExtensionWorker = (t: Target) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://");

/** A Chrome for Testing instance with the extension loaded in a throwaway profile. One per test file. */
export class ExtensionSession {
  readonly extensionId: string;
  private worker: WebWorker;
  private readonly pages = new Set<Page>();

  private constructor(
    readonly browser: Browser,
    readonly userDataDir: string,
    worker: WebWorker,
    extensionId: string,
    /** Shared with the worker listener, so it is drained in place and never replaced. */
    private readonly errors: string[],
  ) {
    this.worker = worker;
    this.extensionId = extensionId;
  }

  /** Launches Chrome with `--load-extension`, in a fresh profile directory, and waits until the service worker is usable. */
  static async launch(): Promise<ExtensionSession> {
    const dist = inject("extensionDir");
    const userDataDir = await mkdtemp(join(tmpdir(), "github-narcissist-feed-e2e-"));
    // HEADED=1 shows the browser; E2E_SLOWMO=<ms> slows every action so it can be followed.
    const headed = process.env.HEADED === "1";
    const browser = await launch({
      executablePath: inject("chromeExecutable"),
      headless: !headed,
      slowMo: Number(process.env.E2E_SLOWMO) || 0,
      userDataDir,
      defaultViewport: VIEWPORT,
      args: [
        `--load-extension=${dist}`,
        `--disable-extensions-except=${dist}`,
        "--no-first-run",
        "--no-default-browser-check",
        ...(headed ? [`--window-size=${VIEWPORT.width},${VIEWPORT.height + 120}`] : []),
      ],
    });
    const errors: string[] = [];
    try {
      const [worker, extensionId] = await connectWorker(browser, errors);
      return new ExtensionSession(browser, userDataDir, worker, extensionId, errors);
    } catch (e) {
      await browser.close().catch(() => {});
      await removeDir(userDataDir);
      throw e;
    }
  }

  /**
   * Opens an extension page in a new tab and brings it to the foreground. Uncaught page errors and `console.error`
   * calls are recorded and fail the running test in {@link afterTest} / {@link assertNoErrors}.
   */
  async openPage({ ready = "#rail" }: OpenPageOptions = {}): Promise<Page> {
    const page = await this.browser.newPage();
    this.pages.add(page);
    page.on("close", () => this.pages.delete(page));
    page.on("pageerror", (e) => this.errors.push(`uncaught page error: ${e instanceof Error ? e.message : String(e)}`));
    page.on("error", (e) => this.errors.push(`page crashed: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") this.errors.push(`console.error: ${m.text()}${m.location().url ? ` (${m.location().url})` : ""}`);
    });
    await page.goto(`chrome-extension://${this.extensionId}/index.html`, { waitUntil: "load" });
    await page.bringToFront();
    await page.waitForSelector(ready, { timeout: 15_000 });
    return page;
  }

  /**
   * Runs `fn` in the extension's service worker. Re-attaches once if the worker was replaced since the last call
   * (Chrome may stop an idle worker and start a new one).
   */
  async inWorker<Args extends unknown[], R>(fn: (...args: Args) => R, ...args: Args): Promise<Awaited<R>> {
    const run = (worker: WebWorker) => (worker as unknown as WorkerEvaluate).evaluate(fn, ...args);
    try {
      return await run(this.worker);
    } catch {
      [this.worker] = await connectWorker(this.browser, this.errors);
      return await run(this.worker);
    }
  }

  /** Everything `chrome.storage.sync` holds right now. */
  syncStorage(): Promise<SyncStorage> {
    return this.inWorker(() => chrome.storage.sync.get<SyncStorage>(null));
  }

  /** Throws if any page or service worker reported an error since the last call. */
  assertNoErrors(): void {
    const errors = this.errors.splice(0);
    if (errors.length) throw new Error(`The extension reported ${errors.length} error(s):\n  ${errors.join("\n  ")}`);
  }

  /** Call from `afterEach`: saves screenshots of every open page when the test failed, then fails on recorded errors. */
  async afterTest(task: FinishedTask): Promise<void> {
    if (task.result?.state === "fail") await this.screenshotPages(task.name);
    this.assertNoErrors();
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => {});
    await removeDir(this.userDataDir);
  }

  private async screenshotPages(testName: string): Promise<void> {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    const stem = testName.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
    let n = 0;
    for (const page of this.pages) {
      await page.screenshot({ path: `${ARTIFACT_DIR}/${stem}-${n++}.png` as `${string}.png` }).catch(() => {});
    }
  }
}

export const launchExtension = (): Promise<ExtensionSession> => ExtensionSession.launch();

/**
 * Finds the extension's service worker and waits until its `chrome.*` bindings exist: a just-started worker can be
 * evaluated before `chrome` is defined. Uncaught worker exceptions are appended to `errors`.
 */
async function connectWorker(browser: Browser, errors: string[]): Promise<[WebWorker, string]> {
  const target = await browser.waitForTarget(isExtensionWorker, { timeout: SERVICE_WORKER_TIMEOUT });
  const worker = await target.worker();
  if (!worker) throw new Error(`The extension service worker at ${target.url()} did not expose a worker handle.`);

  const cdp = await target.createCDPSession();
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown", (e) =>
    errors.push(`uncaught service worker error: ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`),
  );

  const deadline = Date.now() + SERVICE_WORKER_TIMEOUT;
  while (!(await worker.evaluate(() => typeof chrome !== "undefined" && !!chrome.storage).catch(() => false))) {
    if (Date.now() > deadline) throw new Error("The extension service worker started, but chrome.storage never became available.");
    await new Promise((r) => setTimeout(r, 100));
  }
  return [worker, new URL(target.url()).host];
}

async function removeDir(dir: string): Promise<void> {
  // Chrome can still be flushing files for a moment after close.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}

// ---------------------------------------------------------------------------------------------------------------------
// Storage and background refresh
// ---------------------------------------------------------------------------------------------------------------------

/** The service worker's `status` record in `chrome.storage.local`. */
export type RefreshStatus = Status;

/** Stores the token the way the Settings field does; the service worker then validates it and starts a full sweep. */
export function storeToken(page: Page, token: string): Promise<void> {
  return page.evaluate((t) => chrome.storage.local.set({ token: t }), token);
}

/** Waits until the first full sweep has finished (stamped `lastFullAt`, no refresh running) and returns the status. */
export async function waitForFullSweep(page: Page, timeout = 180_000): Promise<RefreshStatus> {
  const handle = await page.waitForFunction(
    async () => {
      const { status } = await chrome.storage.local.get<LocalStorage>("status");
      return status?.lastFullAt && !status.refreshing ? status : null;
    },
    { timeout, polling: 2000 },
  );
  // waitForFunction only resolves once the predicate returned a truthy value, so this is never null.
  return (await handle.jsonValue()) as RefreshStatus;
}

/** Waits until the extension has cached more than `min` events (a sweep may still be running). */
export async function waitForEvents(page: Page, min: number, timeout = 120_000): Promise<void> {
  await page.waitForFunction(
    async (n) => Object.keys((await chrome.storage.local.get<LocalStorage>("events")).events ?? {}).length > n,
    { timeout, polling: 1000 },
    min,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Navigation inside the app
// ---------------------------------------------------------------------------------------------------------------------

/** Clicks the breadcrumb on Settings (if we are there) and waits for the feed toolbar. Feed rows are up to the caller. */
export async function goToFeed(page: Page): Promise<void> {
  await page.bringToFront();
  const back = await page.$('button[aria-label="Back to feed"]');
  await back?.click();
  await page.waitForSelector(".gseg", { timeout: 10_000 });
}

/** Opens Settings from the toolbar gear. */
export async function goToSettings(page: Page): Promise<void> {
  await page.bringToFront();
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector(".settings");
}

/** Counts elements matching `selector`. */
export const count = (page: Page, selector: string): Promise<number> => page.$$eval(selector, (els) => els.length);

// ---------------------------------------------------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------------------------------------------------

export type RailSection = "activity" | "owners" | "people" | "period" | "repositories";

/**
 * What the rail and toolbar show. `null` means "not rendered": a collapsed rail section renders none of its inputs, and
 * the Day/Week/Month control only exists on the feed page (with no token the app opens on Settings).
 */
export interface RailState {
  /** Activity checkboxes by label. Only rows that are rendered appear (the collapsed list shows the first three kinds). */
  kinds: Record<string, boolean>;
  /** Owner checkboxes by login, `null` while the Owners section is collapsed. */
  owners: Record<string, boolean> | null;
  hideMe: boolean | null;
  hideBots: boolean | null;
  /** Value of the checked Period radio (`"7"`, `"30"`, …). */
  period: string | null;
  /** Label of the active toolbar button (`"Day"`, `"Week"`, `"Month"`). */
  group: string | null;
  /** Repository titles (`owner/name`) that are checked. */
  reposChecked: string[];
  /** Collapsed sections, in rail order. */
  closedSections: RailSection[];
  resetVisible: boolean;
}

/** Reads the rail state from the DOM. */
export function readRailState(page: Page): Promise<RailState> {
  return page.evaluate(() => {
    const rows = (root: ParentNode) => [...root.querySelectorAll<HTMLLabelElement>("label.frow")];
    const text = (l: HTMLLabelElement) => l.querySelector(".lbl")?.textContent?.trim() ?? "";
    const checked = (l: HTMLLabelElement) => l.querySelector("input")?.checked ?? false;
    const heading = (id: string) => document.querySelector(`#rail h2[data-sec="${id}"]`);
    /** The `.rsec` that follows a heading, or null while that section is collapsed. */
    const body = (id: string) => {
      const next = heading(id)?.nextElementSibling;
      return next?.classList.contains("rsec") ? next : null;
    };
    const findRow = (id: string, label: string) => {
      const section = body(id);
      return section ? rows(section).find((l) => text(l) === label) : undefined;
    };
    const flag = (id: string, label: string) => {
      const row = findRow(id, label);
      return row ? checked(row) : null;
    };
    const activity = body("activity");
    const owners = body("owners");
    const repos = body("repositories");
    return {
      kinds: Object.fromEntries(activity ? rows(activity).map((l) => [text(l), checked(l)]) : []),
      owners: owners ? Object.fromEntries(rows(owners).map((l) => [text(l), checked(l)])) : null,
      hideMe: flag("people", "Hide my own activity"),
      hideBots: flag("people", "Hide bots"),
      period: document.querySelector<HTMLInputElement>('#rail input[name="period"]:checked')?.value ?? null,
      group:
        [...document.querySelectorAll<HTMLButtonElement>(".gseg button")].find((b) => b.classList.contains("on"))?.textContent?.trim() ??
        null,
      reposChecked: repos
        ? rows(repos)
            .filter((l) => l.title.includes("/") && checked(l))
            .map((l) => l.title)
        : [],
      closedSections: [...document.querySelectorAll("#rail h2[data-sec].closed")].map((h) => h.getAttribute("data-sec")) as RailSection[],
      resetVisible: [...document.querySelectorAll("#rail button")].some((b) => b.textContent?.trim() === "Reset filters"),
    };
  });
}

/**
 * Asserts the rail eventually matches `expected` (a subset, compared like `toMatchObject`). Polled for a few seconds
 * because a freshly loaded page may paint with defaults for a moment before stored or synced prefs are applied.
 */
export function expectRail(page: Page, expected: object, message = "rail state"): Promise<void> {
  return expect.poll(() => readRailState(page), { timeout: 5_000, interval: 100, message }).toMatchObject(expected);
}

async function railInput(page: Page, section: RailSection, label: string): Promise<ElementHandle<HTMLInputElement>> {
  const handle = await page.evaluateHandle(
    (id, text) => {
      const next = document.querySelector(`#rail h2[data-sec="${id}"]`)?.nextElementSibling;
      const rows = next?.classList.contains("rsec") ? [...next.querySelectorAll<HTMLLabelElement>("label.frow")] : [];
      return rows.find((l) => l.querySelector(".lbl")?.textContent?.trim() === text)?.querySelector("input") ?? null;
    },
    section,
    label,
  );
  const el = handle.asElement() as ElementHandle<HTMLInputElement> | null;
  if (!el) throw new Error(`Rail row "${label}" is not rendered in the ${section} section (is the section collapsed?).`);
  return el;
}

/** Clicks a rail checkbox (Activity, People or Owners) by its visible label. */
export async function clickRailRow(page: Page, section: Exclude<RailSection, "period" | "repositories">, label: string): Promise<void> {
  await page.bringToFront();
  await (await railInput(page, section, label)).click();
}

/** Clicks the chevron that collapses or expands a rail section. */
export async function toggleRailSection(page: Page, section: RailSection): Promise<void> {
  await page.bringToFront();
  await page.click(`#rail h2[data-sec="${section}"] .secbtn`);
}

export async function chooseRailPeriod(page: Page, value: string): Promise<void> {
  await page.bringToFront();
  await page.click(`#rail input[name="period"][value="${value}"]`);
}

/** Clicks Day, Week or Month in the toolbar. */
export async function chooseGroup(page: Page, label: "Day" | "Week" | "Month"): Promise<void> {
  await page.bringToFront();
  const handle = await page.evaluateHandle(
    (text) => [...document.querySelectorAll<HTMLButtonElement>(".gseg button")].find((b) => b.textContent?.trim() === text) ?? null,
    label,
  );
  const el = handle.asElement() as ElementHandle<Element> | null;
  if (!el) throw new Error(`The toolbar has no "${label}" button (is the app on the Settings page?).`);
  await el.click();
}

/** Ticks the first row of the Repositories section and returns its `owner/name`. */
export async function pickFirstRepository(page: Page): Promise<string> {
  await page.bringToFront();
  const selector = '#rail h2[data-sec="repositories"] ~ .rsec label.frow[title*="/"]';
  const title = await page.$eval(selector, (l) => (l as HTMLElement).title);
  await page.click(`${selector} input`);
  return title;
}

export async function clickResetFilters(page: Page): Promise<void> {
  await page.bringToFront();
  const button = await page.evaluateHandle(
    () => [...document.querySelectorAll<HTMLButtonElement>("#rail button")].find((b) => b.textContent?.trim() === "Reset filters") ?? null,
  );
  const el = button.asElement() as ElementHandle<Element> | null;
  if (!el) throw new Error('The rail has no "Reset filters" button; the view equals the defaults.');
  await el.click();
}
