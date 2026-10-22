import type { FeedEvent, Group, Kind, Period, Settings } from "./types";

export const KIND_LABELS: Record<Kind, string> = {
  star: "Stars",
  unstar: "Unstars",
  fork: "Forks",
  unfork: "Deleted forks",
  issue: "Issues",
  pr: "Pull requests",
  comment: "Comments",
  review: "Reviews",
  release: "Releases",
};
export const RAIL_KINDS: [Kind, string, string][] = [
  ["star", "Stars", "star"],
  ["fork", "Forks", "repo-forked"],
  ["issue", "Issues", "issue-opened"],
  ["pr", "Pull requests", "git-pull-request"],
  ["comment", "Comments", "comment"],
  ["review", "Reviews", "code-review"],
  ["release", "Releases", "tag"],
];
export const PERIODS: [Period, string][] = [
  ["today", "Today"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 3 months"],
  ["180", "Last 6 months"],
  ["365", "Last 12 months"],
  ["all", "All time"],
];
export const GROUPS: [Group, string][] = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];
export const WINDOWS: [number, string][] = [
  [15, "15 minutes"],
  [30, "30 minutes"],
  [60, "1 hour"],
  [180, "3 hours"],
  [360, "6 hours"],
  [1440, "24 hours"],
];

export const ownerOf = (e: FeedEvent) => e.repo.split("/")[0];
export const periodName = (p: Period) => PERIODS.find((x) => x[0] === p)?.[1] ?? "";

export function periodStart(period: Period, now: Date): number {
  if (period === "all") return 0;
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return now.getTime() - Number(period) * 864e5;
}

// ---------- icons / verbs ----------

export function kindIcon(e: Pick<FeedEvent, "kind" | "state">): [string, string] {
  switch (e.kind) {
    case "star":
      return ["star", "k-star"];
    case "unstar":
      return ["star", "k-neutral"];
    case "fork":
      return ["repo-forked", "k-fork"];
    case "unfork":
      return ["repo-forked", "k-neutral"];
    case "issue":
      return e.state === "OPEN" ? ["issue-opened", "k-open"] : ["issue-closed", "k-merged"];
    case "comment":
      return ["comment", "k-neutral"];
    case "review":
      return e.state === "APPROVED"
        ? ["check-circle", "k-open"]
        : e.state === "CHANGES_REQUESTED"
          ? ["x-circle", "k-closed"]
          : ["code-review", "k-neutral"];
    case "release":
      return ["tag", "k-release"];
  }
  if (e.state === "MERGED") return ["git-merge", "k-merged"];
  if (e.state === "CLOSED") return ["git-pull-request-closed", "k-closed"];
  if (e.state === "DRAFT") return ["git-pull-request-draft", "k-draft"];
  return ["git-pull-request", "k-open"];
}

/** What stacking keys on. */
export function verbClass(e: FeedEvent): string {
  switch (e.kind) {
    case "star":
      return "starred";
    case "unstar":
      return "unstarred";
    case "fork":
      return "forked";
    case "unfork":
      return "unforked";
    case "release":
      return "released";
    case "comment":
      return "commented";
    case "review":
      return e.state === "APPROVED" ? "approved" : e.state === "CHANGES_REQUESTED" ? "requested-changes" : "reviewed";
  }
  if (e.kind === "pr" && e.state === "MERGED") return "merged";
  if (e.state === "CLOSED") return "closed";
  const fresh = !!e.created && Date.parse(e.at) - Date.parse(e.created) < 60_000;
  return fresh ? "opened" : "updated";
}

const NOUN: Record<string, [string, string]> = {
  issue: ["issue", "issues"],
  pr: ["pull request", "pull requests"],
  release: ["release", "releases"],
  comment: ["comment", "comments"],
  review: ["review", "reviews"],
};

export function verbText(e: FeedEvent): string {
  const v = verbClass(e);
  switch (v) {
    case "starred":
    case "forked":
      return v;
    case "unstarred":
      return "unstarred";
    case "unforked":
      return "deleted their fork of";
    case "released":
      return "published release";
    case "commented":
      return "commented on " + (e.state === "PR" ? "pull request" : "issue");
    case "approved":
      return "approved pull request";
    case "requested-changes":
      return "requested changes on pull request";
    case "reviewed":
      return "reviewed pull request";
  }
  const noun = NOUN[e.kind]?.[0] ?? e.kind;
  return e.state === "DRAFT" ? `${v} draft ${noun}` : `${v} ${noun}`;
}

export function plural(v: string, kind: string, n: number): string {
  const s = n === 1 ? "" : "s";
  switch (v) {
    case "starred":
      return `starred ${n} repositor${n === 1 ? "y" : "ies"}`;
    case "unstarred":
      return `unstarred ${n} repositor${n === 1 ? "y" : "ies"}`;
    case "forked":
      return `forked ${n} repositor${n === 1 ? "y" : "ies"}`;
    case "unforked":
      return `deleted ${n} fork${s}`;
    case "released":
      return `published ${n} release${s}`;
    case "commented":
      return `commented ${n} time${s}`;
    case "approved":
      return `approved ${n} pull request${s}`;
    case "requested-changes":
      return `requested changes on ${n} pull request${s}`;
    case "reviewed":
      return `reviewed ${n} pull request${s}`;
  }
  return `${v} ${n} ${NOUN[kind]?.[n === 1 ? 0 : 1] ?? kind}`;
}

// ---------- filtering ----------

export interface FilterState {
  kinds: Set<Kind>;
  owners: Set<string>;
  hideMe: boolean;
  hideBots: boolean;
  period: Period;
  repos: Set<string>;
  q: string;
}

export function filterEvents(all: FeedEvent[], f: FilterState, me: string, now: Date, showUnstars: boolean): FeedEvent[] {
  const q = f.q.trim().toLowerCase();
  const start = periodStart(f.period, now);
  return all.filter(
    (e) =>
      (f.kinds.has(e.kind) ||
        (showUnstars && ((e.kind === "unstar" && f.kinds.has("star")) || (e.kind === "unfork" && f.kinds.has("fork"))))) &&
      f.owners.has(ownerOf(e)) &&
      Date.parse(e.at) >= start &&
      !(f.hideMe && e.actor.toLowerCase() === me.toLowerCase()) &&
      !(f.hideBots && e.bot) &&
      (f.repos.size === 0 || f.repos.has(e.repo)) &&
      (!q || `${e.repo} ${e.actor} ${e.title ?? ""}`.toLowerCase().includes(q)),
  );
}

// ---------- stacking ----------

export interface Single {
  single: FeedEvent;
  at: string;
}
export interface Stack {
  stack: true;
  key: string;
  target: string;
  anchor: number;
  at: string;
  items: Single[];
}
export interface TypeStack {
  typeStack: true;
  kind: Kind;
  key: string;
  at: string;
  items: FeedEvent[];
}
export type Item = Single | Stack | TypeStack;

export const isStack = (it: Item): it is Stack => (it as Stack).stack === true;
export const isTypeStack = (it: Item): it is TypeStack => (it as TypeStack).typeStack === true;
export const flat = (g: Stack) => g.items.map((i) => i.single);

/** One stacking pass: items with the same key within `windowMin` of the group's newest item fold into one stack. */
function stackPass<T extends { at: string }>(
  items: T[],
  keyFn: (it: T) => string,
  windowMin: number,
  target: (it: T) => string,
): (T | { stack: true; key: string; target: string; anchor: number; at: string; items: T[] })[] {
  const out: { stack: true; key: string; target: string; anchor: number; at: string; items: T[] }[] = [];
  const open = new Map<string, (typeof out)[number]>();
  for (const it of items) {
    const key = keyFn(it);
    const t = Date.parse(it.at);
    const g = open.get(key);
    if (g && g.anchor - t <= windowMin * 60_000) {
      g.items.push(it);
      continue;
    }
    const ng = { stack: true as const, target: target(it), key, anchor: t, at: it.at, items: [it] };
    open.set(key, ng);
    out.push(ng);
  }
  return out.map((g) => (g.items.length === 1 ? g.items[0] : g));
}

export function stackEvents(evs: FeedEvent[], s: Pick<Settings, "stack" | "stackScope" | "stackRepoWindow" | "stackOrgWindow">): Item[] {
  const base: Single[] = evs.map((e) => ({ single: e, at: e.at }));
  if (!s.stack || s.stackScope === "type") return base;
  const byRepo = stackPass(
    base,
    (it) => `${it.single.actor}|${it.single.kind}|${verbClass(it.single)}|${it.single.repo}`,
    s.stackRepoWindow,
    (it) => it.single.repo,
  ) as (Single | Stack)[];
  if (s.stackScope !== "org") return byRepo;
  const actorOf = (it: Single | Stack) => (isStack(it) ? it.items[0].single.actor : it.single.actor);
  const orgOf = (it: Single | Stack) => ownerOf(isStack(it) ? it.items[0].single : it.single);
  const byOrg = stackPass(byRepo, (it) => `${actorOf(it)}|${orgOf(it)}`, s.stackOrgWindow, orgOf);
  return byOrg.map((g) => {
    if (!("stack" in g) || !g.stack) return g as Single | Stack;
    const items = (g.items as (Single | Stack)[]).flatMap((i) => (isStack(i) ? i.items : [i]));
    return { ...g, items } as Stack;
  });
}

/** Fold everything of one kind inside a group into one row (scope = "type"). */
export function typeStackGroup(items: Item[], groupKey: string | number): Item[] {
  const out: Item[] = [];
  const seen = new Set<Kind>();
  for (const it of items) {
    if (!("single" in it)) {
      out.push(it);
      continue;
    }
    const k = it.single.kind;
    if (seen.has(k)) continue;
    const same = items.filter((x): x is Single => "single" in x && x.single.kind === k).map((x) => x.single);
    if (same.length < 2) {
      out.push(it);
      continue;
    }
    seen.add(k);
    out.push({ typeStack: true, kind: k, key: `${groupKey}|${k}`, at: same[0].at, items: same });
  }
  return out;
}

export function stackSummary(g: Stack): { text: string; target: string; repos: number } {
  const evs = flat(g);
  const counts: Record<string, number> = {};
  for (const e of evs) {
    const k = `${verbClass(e)}|${e.kind}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const parts = Object.entries(counts).map(([k, n]) => {
    const [v, kind] = k.split("|");
    return plural(v, kind, n);
  });
  const text = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts.at(-1) : parts[0];
  const repos = new Set(evs.map((e) => e.repo));
  const target = repos.size === 1 ? evs[0].repo : g.target;
  return { text, target, repos: repos.size };
}

export function itemCount(it: Item): number {
  return isStack(it) ? it.items.length : isTypeStack(it) ? it.items.length : 1;
}

// ---------- grouping ----------

export interface FeedGroup {
  key: number;
  start: Date;
  items: Item[];
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function startOfWeek(d: Date, weekStart: 0 | 1) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStart + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
export function startOfMonth(d: Date) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}
export function bucketStart(d: Date, group: Group, weekStart: 0 | 1) {
  return group === "day" ? startOfDay(d) : group === "week" ? startOfWeek(d, weekStart) : startOfMonth(d);
}

export function groupItems(items: Item[], group: Group, weekStart: 0 | 1): FeedGroup[] {
  const groups: FeedGroup[] = [];
  for (const it of items) {
    const b = bucketStart(new Date(it.at), group, weekStart);
    const key = b.getTime();
    let g = groups.at(-1);
    if (!g || g.key !== key) {
      g = { key, start: b, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

// ---------- trends ----------

export type Unit = "hour" | "day" | "week" | "month";
export const unitFor = (period: Period, group: Group): Unit => (period === "today" ? "hour" : group);

export function bucketList(period: Period, group: Group, weekStart: 0 | 1, now: Date, earliest: number): Date[] {
  const unit = unitFor(period, group);
  const start = periodStart(period, now) || earliest;
  const floor = (d: Date) => {
    if (unit === "hour") {
      const x = new Date(d);
      x.setMinutes(0, 0, 0);
      return x;
    }
    return bucketStart(d, unit, weekStart);
  };
  const step = (d: Date) => {
    const x = new Date(d);
    if (unit === "hour") x.setHours(x.getHours() + 1);
    else if (unit === "day") x.setDate(x.getDate() + 1);
    else if (unit === "week") x.setDate(x.getDate() + 7);
    else x.setMonth(x.getMonth() + 1);
    return x;
  };
  const out: Date[] = [];
  for (let d = floor(new Date(start)); d <= now; d = step(d)) out.push(d);
  return out.slice(-400); // cap the bar count, but keep the newest buckets: "all time" over years of history must still end today
}

export function floorToUnit(d: Date, unit: Unit, weekStart: 0 | 1): Date {
  if (unit === "hour") {
    const x = new Date(d);
    x.setMinutes(0, 0, 0);
    return x;
  }
  return bucketStart(d, unit, weekStart);
}
