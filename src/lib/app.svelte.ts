import {
  DEFAULT_SETTINGS,
  type FeedEvent,
  type Group,
  type Kind,
  type Message,
  type OwnerMeta,
  type Period,
  type Person,
  type Settings,
  type Status,
} from "./types";
import { ACCENT_VAR_NAMES, accentVars } from "./accent";
import { KEYS, getEvents, getOwners, getPeople, getStatus, getToken, onStorage, setToken } from "./storage";
import {
  DEFAULT_LAYOUT,
  DEFAULT_VIEW,
  MAX_REPOS,
  RAIL_KIND_IDS,
  installFlushOnHide,
  loadPrefs,
  onPrefsChange,
  savePref,
  type LayoutPrefs,
  type RailSection,
  type TrendKind,
  type ViewPrefs,
} from "./prefs";

const freshView = (): ViewPrefs => ({ ...DEFAULT_VIEW, kinds: [...DEFAULT_VIEW.kinds], repos: [...DEFAULT_VIEW.repos] });
const freshLayout = (): LayoutPrefs => ({
  ...DEFAULT_LAYOUT,
  railClosed: [...DEFAULT_LAYOUT.railClosed],
  trendOrder: [...DEFAULT_LAYOUT.trendOrder],
  trendClosed: [...DEFAULT_LAYOUT.trendClosed],
});
/** localStorage key read by public/boot.js before first paint. A cache of the synced settings, never the source of truth. */
const APPEARANCE_CACHE = "appearance";
const darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

const flip = <T>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * Reactive application state (Svelte 5 runes in a module).
 * Synced tier (settings, view, layout) is replaced immutably and handed to prefs.ts; tab-only state lives here and is never persisted.
 * The three synced objects are `$state.raw`: they are only ever replaced, and plain objects go straight to chrome.storage.
 */
class AppState {
  ready = $state(false);
  settings = $state.raw<Settings>({ ...DEFAULT_SETTINGS });
  view = $state.raw<ViewPrefs>(freshView());
  layout = $state.raw<LayoutPrefs>(freshLayout());
  token = $state("");
  events = $state<FeedEvent[]>([]);
  owners = $state<Record<string, OwnerMeta>>({});
  people = $state<Person[]>([]);
  status = $state<Status>({});
  now = $state(new Date());
  /** The OS colour scheme, for showing swatches as they will look under "System". */
  systemDark = $state(darkQuery?.matches ?? false);

  // tab-only state
  page = $state<"feed" | "settings">("feed");
  q = $state("");
  rq = $state("");
  collapsed = $state(new Set<number>());
  expanded = $state(new Set<string>());
  shown = $state(40);
  ownerPop = $state(false);
  groupKeys = $state<number[]>([]);

  me = $derived(this.settings.username || this.status.viewer || "");
  /** True only while a sweep is really running; a flag older than 3 minutes means the worker died. */
  refreshing = $derived(
    !!this.status.refreshing && !!this.status.refreshingSince && this.now.getTime() - Date.parse(this.status.refreshingSince) < 3 * 60_000,
  );
  hasToken = $derived(this.token.length > 0);
  ownersOn = $derived(new Set(this.settings.owners.filter((o) => o.on).map((o) => o.login)));
  kindSet = $derived(new Set<Kind>(this.view.kinds));
  repoSet = $derived(new Set(this.view.repos));

  private booting?: Promise<void>;
  boot() {
    return (this.booting ??= this.load());
  }

  private async load() {
    const [prefs, token, events, owners, people, status] = await Promise.all([
      loadPrefs(),
      getToken(),
      getEvents(),
      getOwners(),
      getPeople(),
      getStatus(),
    ]);
    this.settings = prefs.settings;
    this.view = prefs.view;
    this.layout = prefs.layout;
    this.token = token;
    this.owners = owners;
    this.people = people;
    this.status = status;
    this.setEvents(events);
    this.applyTheme();
    darkQuery?.addEventListener("change", (e) => (this.systemDark = e.matches));
    this.ready = true;
    installFlushOnHide();
    onPrefsChange((key, value) => {
      if (key === "settings") {
        this.settings = value as Settings;
        this.applyTheme();
      } else if (key === "view") {
        this.view = value as ViewPrefs;
        this.shown = 40;
      } else this.layout = value as LayoutPrefs;
    });
    onStorage((changes, area) => {
      if (area !== "local") return;
      if (changes[KEYS.events]) this.setEvents((changes[KEYS.events].newValue ?? {}) as Record<string, FeedEvent>);
      if (changes[KEYS.owners]) this.owners = (changes[KEYS.owners].newValue ?? {}) as Record<string, OwnerMeta>;
      if (changes[KEYS.people]) this.people = (changes[KEYS.people].newValue ?? []) as Person[];
      if (changes[KEYS.status]) this.status = (changes[KEYS.status].newValue ?? {}) as Status;
      if (changes[KEYS.token]) this.token = (changes[KEYS.token].newValue ?? "") as string;
    });
    setInterval(() => (this.now = new Date()), 15_000);
  }

  private setEvents(map: Record<string, FeedEvent>) {
    this.events = Object.values(map).toSorted((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  /** True when the page currently renders dark (explicit theme, or "system" on a dark OS). */
  get dark() {
    return this.settings.theme === "dark" || (this.settings.theme === "system" && this.systemDark);
  }

  /** Theme, density and accent onto <html>, mirrored to localStorage so public/boot.js can apply them before first paint. */
  applyTheme() {
    const root = document.documentElement;
    const { theme, density, accent } = this.settings;
    const dataTheme = theme === "system" ? null : theme;
    const dataDensity = density === "compact" ? "compact" : null;
    const vars = accentVars(accent);
    if (dataTheme) root.setAttribute("data-theme", dataTheme);
    else root.removeAttribute("data-theme");
    if (dataDensity) root.setAttribute("data-density", dataDensity);
    else root.removeAttribute("data-density");
    for (const name of ACCENT_VAR_NAMES) root.style.removeProperty(name);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    try {
      localStorage.setItem(APPEARANCE_CACHE, JSON.stringify({ theme: dataTheme, density: dataDensity, vars }));
    } catch {
      // Storage full or disabled: the page still themes itself once settings load, only a moment later.
    }
  }

  // ---------- synced writers: replace the object, then hand it to prefs.ts ----------

  save(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    savePref("settings", this.settings);
    this.applyTheme();
  }
  private patchView(patch: Partial<ViewPrefs>) {
    this.view = { ...this.view, ...patch };
    this.shown = 40;
    savePref("view", this.view);
  }
  private patchLayout(patch: Partial<LayoutPrefs>) {
    this.layout = { ...this.layout, ...patch };
    savePref("layout", this.layout);
  }

  async saveToken(token: string) {
    await setToken(token);
    this.token = token.trim();
  }

  // view (rail and toolbar filters)
  setPeriod(period: Period) {
    this.patchView({ period });
  }
  setGroup(group: Group) {
    this.patchView({ group });
  }
  /** Keeps canonical rail order so equal selections serialise equally on every computer. */
  toggleKind(k: Kind, on: boolean) {
    this.patchView({ kinds: RAIL_KIND_IDS.filter((x) => (x === k ? on : this.kindSet.has(x))) });
  }
  setHideMe(hideMe: boolean) {
    this.patchView({ hideMe });
  }
  setHideBots(hideBots: boolean) {
    this.patchView({ hideBots });
  }
  /** Most recently selected last; the oldest selection falls off past MAX_REPOS. */
  toggleRepo(r: string, on: boolean) {
    this.patchView({
      repos: on ? [...this.view.repos.filter((x) => x !== r), r].slice(-MAX_REPOS) : this.view.repos.filter((x) => x !== r),
    });
  }
  /** Back to defaults for everything that filters content; period and group stay. */
  resetFilters() {
    this.patchView({ ...freshView(), period: this.view.period, group: this.view.group });
  }

  // layout (collapsed sections, "show all", trend panels)
  toggleRailSection(id: RailSection) {
    this.patchLayout({ railClosed: flip(this.layout.railClosed, id) });
  }
  setAllKinds(allKinds: boolean) {
    this.patchLayout({ allKinds });
  }
  setAllRepos(allRepos: boolean) {
    this.patchLayout({ allRepos });
  }
  setTrendOrder(trendOrder: TrendKind[]) {
    this.patchLayout({ trendOrder });
  }
  toggleTrendClosed(k: TrendKind) {
    this.patchLayout({ trendClosed: flip(this.layout.trendClosed, k) });
  }
  resetLayout() {
    this.layout = freshLayout();
    savePref("layout", this.layout);
  }

  // owners (settings.owners, `on` drives ownersOn)
  toggleSet<T>(set: Set<T>, v: T, on: boolean): Set<T> {
    const n = new Set(set);
    if (on) n.add(v);
    else n.delete(v);
    return n;
  }
  toggleOwnerOn(login: string, on: boolean) {
    this.save({ owners: this.settings.owners.map((o) => (o.login === login ? { ...o, on } : o)) });
  }
  addOwner(login: string, type: "user" | "org") {
    if (this.settings.owners.some((o) => o.login.toLowerCase() === login.toLowerCase())) return;
    this.save({ owners: [...this.settings.owners, { login, type, on: true }] });
    void send({ type: "resolveOwner", login });
  }
  removeOwner(login: string) {
    if (login.toLowerCase() === this.me.toLowerCase()) return;
    this.save({ owners: this.settings.owners.filter((o) => o.login !== login) });
  }
}

export const app = new AppState();

export function send<T = unknown>(message: Message): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
