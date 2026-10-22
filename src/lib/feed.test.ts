import { describe, expect, it } from "vitest";
import { makeEvent, REPO } from "../../tests/helpers/factories";
import {
  bucketList,
  filterEvents,
  flat,
  floorToUnit,
  groupItems,
  isStack,
  isTypeStack,
  itemCount,
  kindIcon,
  ownerOf,
  periodName,
  periodStart,
  plural,
  stackEvents,
  stackSummary,
  startOfDay,
  startOfMonth,
  startOfWeek,
  typeStackGroup,
  unitFor,
  verbClass,
  verbText,
  type FilterState,
  type Item,
  type Single,
  type Stack,
  type TypeStack,
} from "./feed";
import type { FeedEvent, Group, Kind, Period } from "./types";

/** Thursday 22 October 2026, 14:30 in Europe/Oslo (CEST, UTC+2). The clock is never read: every function takes `now`. */
const NOW = new Date(2026, 9, 22, 14, 30, 0);
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

const BASE = Date.parse("2026-10-22T12:00:00Z");
/** ISO timestamp `minutes` before 12:00Z. Feeds are sorted newest first, so larger numbers come later in a list. */
const ago = (minutes: number) => new Date(BASE - minutes * 60_000).toISOString();
const single = (e: FeedEvent): Single => ({ single: e, at: e.at });
const ids = (events: FeedEvent[]) => events.map((e) => e.id);

type StackSettings = Parameters<typeof stackEvents>[1];
const ALL_KINDS: Kind[] = ["star", "fork", "issue", "pr", "comment", "review", "release"];

// ---------------------------------------------------------------------------------------------------------------------
describe("ownerOf / periodName", () => {
  it("takes the owner from the repository's full name", () => {
    expect(ownerOf(makeEvent({ repo: "acme/widgets" }))).toBe("acme");
  });

  it("names each period, and gives an empty string for an unknown one", () => {
    expect(periodName("today")).toBe("Today");
    expect(periodName("90")).toBe("Last 3 months");
    expect(periodName("all")).toBe("All time");
    expect(periodName("nonsense" as Period)).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("periodStart", () => {
  it("is 0 for all time", () => {
    expect(periodStart("all", NOW)).toBe(0);
  });

  it("is local midnight for today, which is 22:00Z the evening before in Oslo", () => {
    const start = periodStart("today", NOW);
    expect(new Date(start).toISOString()).toBe("2026-10-21T22:00:00.000Z");
    expect(start).toBe(local(2026, 10, 22).getTime());
  });

  it.each([
    ["7", 7],
    ["30", 30],
    ["90", 90],
    ["180", 180],
    ["365", 365],
  ] as [Period, number][])("is exactly %s days before now for a rolling period", (period, days) => {
    expect(periodStart(period, NOW)).toBe(NOW.getTime() - days * 86_400_000);
  });

  it("does not modify the date it was given", () => {
    const now = new Date(NOW);
    periodStart("today", now);
    expect(now.getTime()).toBe(NOW.getTime());
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("kindIcon", () => {
  const cases: [Kind, string | undefined, [string, string]][] = [
    ["star", undefined, ["star", "k-star"]],
    ["unstar", undefined, ["star", "k-neutral"]],
    ["fork", undefined, ["repo-forked", "k-fork"]],
    ["unfork", undefined, ["repo-forked", "k-neutral"]],
    ["issue", "OPEN", ["issue-opened", "k-open"]],
    ["issue", "CLOSED", ["issue-closed", "k-merged"]],
    ["pr", "OPEN", ["git-pull-request", "k-open"]],
    ["pr", "DRAFT", ["git-pull-request-draft", "k-draft"]],
    ["pr", "MERGED", ["git-merge", "k-merged"]],
    ["pr", "CLOSED", ["git-pull-request-closed", "k-closed"]],
    ["comment", "ISSUE", ["comment", "k-neutral"]],
    ["comment", "PR", ["comment", "k-neutral"]],
    ["review", "APPROVED", ["check-circle", "k-open"]],
    ["review", "CHANGES_REQUESTED", ["x-circle", "k-closed"]],
    ["review", "COMMENTED", ["code-review", "k-neutral"]],
    ["review", "DISMISSED", ["code-review", "k-neutral"]],
    ["release", undefined, ["tag", "k-release"]],
  ];
  it.each(cases)("%s %s -> %j", (kind, state, expected) => {
    expect(kindIcon({ kind, state })).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("verbClass / verbText", () => {
  const T = "2026-10-22T10:00:00Z";
  const plusMs = (ms: number) => new Date(Date.parse(T) + ms).toISOString();

  const cases: [string, Partial<FeedEvent>, string, string][] = [
    ["a star", { kind: "star" }, "starred", "starred"],
    ["an unstar", { kind: "unstar" }, "unstarred", "unstarred"],
    ["a fork", { kind: "fork" }, "forked", "forked"],
    ["a deleted fork", { kind: "unfork" }, "unforked", "deleted their fork of"],
    ["a release", { kind: "release" }, "released", "published release"],
    ["a comment on an issue", { kind: "comment", state: "ISSUE" }, "commented", "commented on issue"],
    ["a comment on a PR", { kind: "comment", state: "PR" }, "commented", "commented on pull request"],
    ["an approving review", { kind: "review", state: "APPROVED" }, "approved", "approved pull request"],
    [
      "a review requesting changes",
      { kind: "review", state: "CHANGES_REQUESTED" },
      "requested-changes",
      "requested changes on pull request",
    ],
    ["a review comment", { kind: "review", state: "COMMENTED" }, "reviewed", "reviewed pull request"],
    ["a dismissed review", { kind: "review", state: "DISMISSED" }, "reviewed", "reviewed pull request"],
    ["a new issue", { kind: "issue", state: "OPEN", created: T, at: plusMs(30_000) }, "opened", "opened issue"],
    [
      "an older issue with new activity",
      { kind: "issue", state: "OPEN", created: "2026-10-20T10:00:00Z", at: T },
      "updated",
      "updated issue",
    ],
    ["a closed issue", { kind: "issue", state: "CLOSED", created: "2026-10-20T10:00:00Z", at: T }, "closed", "closed issue"],
    ["a new open PR", { kind: "pr", state: "OPEN", created: T, at: plusMs(5_000) }, "opened", "opened pull request"],
    [
      "an older open PR with new activity",
      { kind: "pr", state: "OPEN", created: "2026-10-20T10:00:00Z", at: T },
      "updated",
      "updated pull request",
    ],
    ["a merged PR", { kind: "pr", state: "MERGED", created: "2026-10-20T10:00:00Z", at: T }, "merged", "merged pull request"],
    ["a closed PR", { kind: "pr", state: "CLOSED", created: "2026-10-20T10:00:00Z", at: T }, "closed", "closed pull request"],
    ["a new draft PR", { kind: "pr", state: "DRAFT", created: T, at: plusMs(1_000) }, "opened", "opened draft pull request"],
    [
      "an older draft PR with new activity",
      { kind: "pr", state: "DRAFT", created: "2026-10-20T10:00:00Z", at: T },
      "updated",
      "updated draft pull request",
    ],
  ];
  it.each(cases)("%s", (_name, over, cls, text) => {
    const e = makeEvent(over);
    expect(verbClass(e)).toBe(cls);
    expect(verbText(e)).toBe(text);
  });

  describe("opened vs updated", () => {
    const issue = (created: string | null | undefined, at: string) => makeEvent({ kind: "issue", state: "OPEN", created, at });

    it("calls it opened when the last activity is less than a minute after creation", () => {
      expect(verbClass(issue(T, plusMs(59_999)))).toBe("opened");
      expect(verbClass(issue(T, T))).toBe("opened");
    });

    it("calls it updated from exactly one minute after creation", () => {
      expect(verbClass(issue(T, plusMs(60_000)))).toBe("updated");
    });

    it("calls it updated when the creation time is unknown", () => {
      expect(verbClass(issue(null, T))).toBe("updated");
      expect(verbClass(issue(undefined, T))).toBe("updated");
    });

    it("lets closed and merged win over opened: an issue closed seconds after it was opened is closed", () => {
      expect(verbClass(makeEvent({ kind: "issue", state: "CLOSED", created: T, at: plusMs(5_000) }))).toBe("closed");
      expect(verbClass(makeEvent({ kind: "pr", state: "MERGED", created: T, at: plusMs(5_000) }))).toBe("merged");
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("plural", () => {
  const cases: [string, string, number, string][] = [
    ["starred", "star", 1, "starred 1 repository"],
    ["starred", "star", 3, "starred 3 repositories"],
    ["unstarred", "unstar", 1, "unstarred 1 repository"],
    ["unstarred", "unstar", 2, "unstarred 2 repositories"],
    ["forked", "fork", 1, "forked 1 repository"],
    ["forked", "fork", 4, "forked 4 repositories"],
    ["unforked", "unfork", 1, "deleted 1 fork"],
    ["unforked", "unfork", 2, "deleted 2 forks"],
    ["released", "release", 1, "published 1 release"],
    ["released", "release", 3, "published 3 releases"],
    ["commented", "comment", 1, "commented 1 time"],
    ["commented", "comment", 5, "commented 5 times"],
    ["approved", "review", 1, "approved 1 pull request"],
    ["approved", "review", 2, "approved 2 pull requests"],
    ["requested-changes", "review", 1, "requested changes on 1 pull request"],
    ["requested-changes", "review", 2, "requested changes on 2 pull requests"],
    ["reviewed", "review", 1, "reviewed 1 pull request"],
    ["reviewed", "review", 6, "reviewed 6 pull requests"],
    ["opened", "issue", 1, "opened 1 issue"],
    ["opened", "issue", 3, "opened 3 issues"],
    ["closed", "issue", 2, "closed 2 issues"],
    ["updated", "pr", 1, "updated 1 pull request"],
    ["merged", "pr", 2, "merged 2 pull requests"],
  ];
  it.each(cases)("%s / %s / %i -> %s", (verb, kind, n, expected) => {
    expect(plural(verb, kind, n)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("filterEvents", () => {
  const ME = "HelgeSverre";
  const filter = (over: Partial<FilterState> = {}): FilterState => ({
    kinds: new Set(ALL_KINDS),
    owners: new Set(["HelgeSverre", "acme"]),
    hideMe: false,
    hideBots: false,
    period: "all",
    repos: new Set(),
    q: "",
    ...over,
  });
  const run = (events: FeedEvent[], f: FilterState = filter(), showUnstars = false, me = ME) =>
    ids(filterEvents(events, f, me, NOW, showUnstars));

  describe("by kind", () => {
    const events = ALL_KINDS.map((kind) => makeEvent({ id: kind, kind }));

    it("keeps only the selected kinds", () => {
      expect(run(events, filter({ kinds: new Set<Kind>(["issue", "pr"]) }))).toEqual(["issue", "pr"]);
    });
    it("keeps everything when every kind is selected, and nothing when none is", () => {
      expect(run(events)).toEqual(ALL_KINDS);
      expect(run(events, filter({ kinds: new Set() }))).toEqual([]);
    });
  });

  describe("unstars and deleted forks", () => {
    const events = [
      makeEvent({ id: "star", kind: "star" }),
      makeEvent({ id: "unstar", kind: "unstar" }),
      makeEvent({ id: "fork", kind: "fork" }),
      makeEvent({ id: "unfork", kind: "unfork" }),
    ];
    const starsAndForks = new Set<Kind>(["star", "fork"]);

    it("hides them when showUnstars is off, even though stars and forks are selected", () => {
      expect(run(events, filter({ kinds: starsAndForks }), false)).toEqual(["star", "fork"]);
    });
    it("shows them next to stars and forks when showUnstars is on", () => {
      expect(run(events, filter({ kinds: starsAndForks }), true)).toEqual(["star", "unstar", "fork", "unfork"]);
    });
    it("ties an unstar to the star kind and a deleted fork to the fork kind", () => {
      expect(run(events, filter({ kinds: new Set<Kind>(["star"]) }), true)).toEqual(["star", "unstar"]);
      expect(run(events, filter({ kinds: new Set<Kind>(["fork"]) }), true)).toEqual(["fork", "unfork"]);
    });
    it("shows neither when no matching kind is selected", () => {
      expect(run(events, filter({ kinds: new Set<Kind>(["issue"]) }), true)).toEqual([]);
    });
    it("still applies the other filters to them", () => {
      const mine = [
        makeEvent({ id: "unstar-me", kind: "unstar", actor: ME }),
        makeEvent({ id: "unstar-bob", kind: "unstar", actor: "bob" }),
      ];
      expect(run(mine, filter({ hideMe: true }), true)).toEqual(["unstar-bob"]);
    });
  });

  describe("by owner", () => {
    const events = [
      makeEvent({ id: "mine", repo: "HelgeSverre/a" }),
      makeEvent({ id: "acme", repo: "acme/b" }),
      makeEvent({ id: "other", repo: "torvalds/linux" }),
    ];

    it("keeps events from repositories of the selected owners", () => {
      expect(run(events, filter({ owners: new Set(["acme"]) }))).toEqual(["acme"]);
      expect(run(events, filter({ owners: new Set(["acme", "HelgeSverre"]) }))).toEqual(["mine", "acme"]);
    });
    it("shows nothing when no owner is selected", () => {
      expect(run(events, filter({ owners: new Set() }))).toEqual([]);
    });
  });

  describe("by period", () => {
    it("today: from local midnight, inclusive", () => {
      const events = [
        makeEvent({ id: "this-morning", at: "2026-10-22T05:00:00Z" }),
        makeEvent({ id: "at-midnight", at: "2026-10-21T22:00:00Z" }),
        makeEvent({ id: "a-second-before", at: "2026-10-21T21:59:59Z" }),
      ];
      expect(run(events, filter({ period: "today" }))).toEqual(["this-morning", "at-midnight"]);
    });
    it("7 days: rolling from now, inclusive", () => {
      const events = [
        makeEvent({ id: "inside", at: "2026-10-16T00:00:00Z" }),
        makeEvent({ id: "exactly-7d", at: "2026-10-15T12:30:00Z" }),
        makeEvent({ id: "a-second-before", at: "2026-10-15T12:29:59Z" }),
      ];
      expect(run(events, filter({ period: "7" }))).toEqual(["inside", "exactly-7d"]);
    });
    it("all time: keeps old events", () => {
      expect(run([makeEvent({ id: "ancient", at: "2019-03-01T00:00:00Z" })], filter({ period: "all" }))).toEqual(["ancient"]);
    });
  });

  describe("hide me", () => {
    const events = [makeEvent({ id: "me", actor: "HelgeSverre" }), makeEvent({ id: "other", actor: "alice" })];

    it("leaves everything alone when off", () => {
      expect(run(events, filter({ hideMe: false }))).toEqual(["me", "other"]);
    });
    it("hides the viewer's own activity", () => {
      expect(run(events, filter({ hideMe: true }))).toEqual(["other"]);
    });
    it("compares logins case-insensitively in both directions", () => {
      expect(run(events, filter({ hideMe: true }), false, "helgesverre")).toEqual(["other"]);
      expect(run([makeEvent({ id: "lower", actor: "helgesverre" })], filter({ hideMe: true }), false, "HELGESVERRE")).toEqual([]);
    });
    it("does not hide anything when the viewer is unknown", () => {
      expect(run(events, filter({ hideMe: true }), false, "")).toEqual(["me", "other"]);
    });
  });

  describe("hide bots", () => {
    const events = [makeEvent({ id: "bot", actor: "dependabot", bot: true }), makeEvent({ id: "human", actor: "alice" })];
    it("hides bot events only when on", () => {
      expect(run(events, filter({ hideBots: false }))).toEqual(["bot", "human"]);
      expect(run(events, filter({ hideBots: true }))).toEqual(["human"]);
    });
  });

  describe("by repository", () => {
    const events = [
      makeEvent({ id: "feed", repo: "HelgeSverre/github-narcissist-feed" }),
      makeEvent({ id: "other", repo: "HelgeSverre/other" }),
      makeEvent({ id: "acme", repo: "acme/widgets" }),
    ];

    it("keeps everything when the set is empty", () => {
      expect(run(events, filter({ repos: new Set() }))).toEqual(["feed", "other", "acme"]);
    });
    it("keeps only the listed repositories, matched by full name", () => {
      expect(run(events, filter({ repos: new Set(["HelgeSverre/github-narcissist-feed", "acme/widgets"]) }))).toEqual(["feed", "acme"]);
      expect(run(events, filter({ repos: new Set(["github-narcissist-feed"]) }))).toEqual([]);
    });
  });

  describe("search text", () => {
    const events = [
      makeEvent({
        id: "title",
        kind: "issue",
        title: "Dark mode flashes on load",
        actor: "alice",
        repo: "HelgeSverre/github-narcissist-feed",
      }),
      makeEvent({ id: "actor", kind: "star", actor: "DarkLord", repo: "HelgeSverre/other" }),
      makeEvent({ id: "repo", kind: "star", actor: "bob", repo: "acme/dark-theme" }),
      makeEvent({ id: "none", kind: "star", actor: "carol", repo: "acme/widgets" }),
    ];

    it("matches the title, the actor and the repository, ignoring case", () => {
      expect(run(events, filter({ q: "dark" }))).toEqual(["title", "actor", "repo"]);
      expect(run(events, filter({ q: "FLASHES" }))).toEqual(["title"]);
      expect(run(events, filter({ q: "darklord" }))).toEqual(["actor"]);
      expect(run(events, filter({ q: "ACME/dark" }))).toEqual(["repo"]);
    });
    it("ignores surrounding whitespace, and a blank query filters nothing", () => {
      expect(run(events, filter({ q: "  flashes  " }))).toEqual(["title"]);
      expect(run(events, filter({ q: "   " }))).toEqual(["title", "actor", "repo", "none"]);
    });
    it("copes with events that have no title", () => {
      expect(run(events, filter({ q: "undefined" }))).toEqual([]);
      expect(run(events, filter({ q: "null" }))).toEqual([]);
    });
    it("returns nothing when nothing matches", () => {
      expect(run(events, filter({ q: "zzz" }))).toEqual([]);
    });
  });

  it("combines every dimension, keeps the input order and does not touch the input", () => {
    const events = [
      makeEvent({ id: "keep-1", kind: "issue", actor: "alice", repo: "acme/widgets", title: "Fix flicker", at: "2026-10-22T08:00:00Z" }),
      makeEvent({ id: "wrong-kind", kind: "star", actor: "alice", repo: "acme/widgets", title: "Fix flicker", at: "2026-10-22T08:00:00Z" }),
      makeEvent({
        id: "bot",
        kind: "issue",
        actor: "renovate",
        bot: true,
        repo: "acme/widgets",
        title: "Fix flicker",
        at: "2026-10-22T08:00:00Z",
      }),
      makeEvent({ id: "me", kind: "issue", actor: ME, repo: "acme/widgets", title: "Fix flicker", at: "2026-10-22T08:00:00Z" }),
      makeEvent({ id: "old", kind: "issue", actor: "alice", repo: "acme/widgets", title: "Fix flicker", at: "2026-10-20T08:00:00Z" }),
      makeEvent({
        id: "other-repo",
        kind: "issue",
        actor: "alice",
        repo: "acme/gadgets",
        title: "Fix flicker",
        at: "2026-10-22T08:00:00Z",
      }),
      makeEvent({ id: "other-text", kind: "issue", actor: "alice", repo: "acme/widgets", title: "Add docs", at: "2026-10-22T08:00:00Z" }),
      makeEvent({
        id: "keep-2",
        kind: "issue",
        actor: "bob",
        repo: "acme/widgets",
        title: "Fix flicker again",
        at: "2026-10-22T07:00:00Z",
      }),
    ];
    const copy = structuredClone(events);
    const f = filter({
      kinds: new Set<Kind>(["issue"]),
      owners: new Set(["acme"]),
      period: "today",
      hideMe: true,
      hideBots: true,
      repos: new Set(["acme/widgets"]),
      q: "flicker",
    });
    expect(run(events, f)).toEqual(["keep-1", "keep-2"]);
    expect(events).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("stackEvents", () => {
  const repoScope: StackSettings = { stack: true, stackScope: "repo", stackRepoWindow: 60, stackOrgWindow: 180 };
  const orgScope: StackSettings = { ...repoScope, stackScope: "org" };

  /** `alice` commenting on an issue `minutes` before 12:00Z. */
  const comment = (id: string, minutes: number, over: Partial<FeedEvent> = {}) =>
    makeEvent({ id, kind: "comment", state: "ISSUE", actor: "alice", at: ago(minutes), ...over });
  /** Readable shape of a stacked list: a stack becomes the array of its event ids, a lone event its id. */
  const shape = (items: Item[]) =>
    items.map((it) => (isStack(it) ? it.items.map((i) => i.single.id) : isTypeStack(it) ? it.items.map((e) => e.id) : it.single.id));

  describe("when not stacking", () => {
    const events = [comment("c1", 0), comment("c2", 5), comment("c3", 10)];

    it("returns one single per event, in order, when stacking is off", () => {
      const items = stackEvents(events, { ...repoScope, stack: false });
      expect(items).toEqual(events.map(single));
    });
    it("returns singles for the type scope, which is applied per group later by typeStackGroup", () => {
      expect(stackEvents(events, { ...repoScope, stackScope: "type" })).toEqual(events.map(single));
    });
    it("returns an empty list for no events", () => {
      expect(stackEvents([], orgScope)).toEqual([]);
    });
  });

  describe("repo scope", () => {
    it("stacks one actor's same-kind, same-verb activity in one repository inside the window", () => {
      const events = [comment("c1", 0), comment("c2", 20), comment("c3", 45)];
      const [stack, ...rest] = stackEvents(events, repoScope);
      expect(rest).toEqual([]);
      expect(stack).toEqual({
        stack: true,
        key: `alice|comment|commented|${REPO}`,
        target: REPO,
        anchor: BASE,
        at: ago(0),
        items: events.map(single),
      });
    });

    it("measures the window from the newest event of the stack and includes the boundary", () => {
      expect(shape(stackEvents([comment("c1", 0), comment("c2", 60)], repoScope))).toEqual([["c1", "c2"]]);
      expect(shape(stackEvents([comment("c1", 0), comment("c2", 61)], repoScope))).toEqual(["c1", "c2"]);
    });

    it("does not chain: events 40 and 80 minutes behind the newest give a stack and a single, not one stack", () => {
      expect(shape(stackEvents([comment("c1", 0), comment("c2", 40), comment("c3", 80)], repoScope))).toEqual([["c1", "c2"], "c3"]);
    });

    it("attaches later events to the newest open stack once a new one has started", () => {
      expect(shape(stackEvents([comment("c1", 0), comment("c2", 70), comment("c3", 100)], repoScope))).toEqual(["c1", ["c2", "c3"]]);
    });

    it("honours the configured window", () => {
      const events = [comment("c1", 0), comment("c2", 10), comment("c3", 20)];
      expect(shape(stackEvents(events, { ...repoScope, stackRepoWindow: 15 }))).toEqual([["c1", "c2"], "c3"]);
      expect(shape(stackEvents(events, { ...repoScope, stackRepoWindow: 1440 }))).toEqual([["c1", "c2", "c3"]]);
    });

    it("keeps different actors apart", () => {
      expect(shape(stackEvents([comment("a1", 0), comment("b1", 5, { actor: "bob" }), comment("a2", 10)], repoScope))).toEqual([
        ["a1", "a2"],
        "b1",
      ]);
    });

    it("keeps different repositories apart", () => {
      expect(shape(stackEvents([comment("x1", 0), comment("y1", 5, { repo: "HelgeSverre/other" }), comment("x2", 10)], repoScope))).toEqual(
        [["x1", "x2"], "y1"],
      );
    });

    it("keeps different kinds apart", () => {
      const events = [
        comment("c1", 0),
        makeEvent({ id: "r1", kind: "review", state: "COMMENTED", actor: "alice", at: ago(5) }),
        comment("c2", 10),
      ];
      expect(shape(stackEvents(events, repoScope))).toEqual([["c1", "c2"], "r1"]);
    });

    it("keeps different verbs apart: approving and requesting changes are separate stacks", () => {
      const review = (id: string, minutes: number, state: string) =>
        makeEvent({ id, kind: "review", state, actor: "alice", at: ago(minutes) });
      const events = [
        review("ok1", 0, "APPROVED"),
        review("no1", 5, "CHANGES_REQUESTED"),
        review("ok2", 10, "APPROVED"),
        review("no2", 15, "CHANGES_REQUESTED"),
      ];
      expect(shape(stackEvents(events, repoScope))).toEqual([
        ["ok1", "ok2"],
        ["no1", "no2"],
      ]);
    });

    it("keeps an issue that was opened apart from one that was closed", () => {
      const opened = makeEvent({ id: "opened", kind: "issue", state: "OPEN", actor: "alice", created: ago(0), at: ago(0) });
      const closed = makeEvent({ id: "closed", kind: "issue", state: "CLOSED", actor: "alice", created: ago(500), at: ago(5) });
      expect(shape(stackEvents([opened, closed], repoScope))).toEqual(["opened", "closed"]);
    });

    it("places a stack where its newest event was and leaves other events in place", () => {
      const events = [comment("a1", 0), comment("b1", 5, { actor: "bob" }), comment("a2", 10), comment("c1", 12, { actor: "carol" })];
      expect(shape(stackEvents(events, repoScope))).toEqual([["a1", "a2"], "b1", "c1"]);
    });

    it("leaves a lone event as a single", () => {
      expect(stackEvents([comment("c1", 0)], repoScope)).toEqual([single(comment("c1", 0))]);
    });
  });

  describe("org scope", () => {
    const acme = (id: string, minutes: number, repo: string, over: Partial<FeedEvent> = {}) =>
      comment(id, minutes, { repo: `acme/${repo}`, ...over });

    it("stacks one actor's activity across the repositories of one organization into a flat stack targeting the org", () => {
      const events = [acme("w1", 0, "widgets"), acme("g1", 30, "gadgets"), acme("w2", 90, "widgets")];
      const items = stackEvents(events, orgScope);
      expect(shape(items)).toEqual([["w1", "g1", "w2"]]);
      const stack = items[0] as Stack;
      expect(stack).toMatchObject({ stack: true, key: "alice|acme", target: "acme", anchor: BASE, at: ago(0) });
      expect(stack.items.every((i) => "single" in i && !("stack" in i))).toBe(true);
    });

    it("also joins same-repo events that were too far apart for the repo window", () => {
      expect(shape(stackEvents([acme("w1", 0, "widgets"), acme("w2", 100, "widgets")], orgScope))).toEqual([["w1", "w2"]]);
    });

    it("keeps a repo stack as it is when nothing in the organization joins it", () => {
      const [stack] = stackEvents([acme("w1", 0, "widgets"), acme("w2", 10, "widgets")], orgScope);
      expect(stack).toMatchObject({ stack: true, key: `alice|comment|commented|acme/widgets`, target: "acme/widgets" });
      expect(shape([stack])).toEqual([["w1", "w2"]]);
    });

    it("mixes kinds and verbs inside the organization", () => {
      const events = [acme("w1", 0, "widgets"), makeEvent({ id: "s1", kind: "star", actor: "alice", repo: "acme/gadgets", at: ago(10) })];
      expect(shape(stackEvents(events, orgScope))).toEqual([["w1", "s1"]]);
    });

    it("splits at the organization window", () => {
      const events = [acme("w1", 0, "widgets"), acme("g1", 180, "gadgets"), acme("g2", 181, "gizmos")];
      expect(shape(stackEvents(events, orgScope))).toEqual([["w1", "g1"], "g2"]);
      expect(shape(stackEvents(events, { ...orgScope, stackOrgWindow: 120 }))).toEqual(["w1", ["g1", "g2"]]);
    });

    it("keeps different actors apart", () => {
      const events = [acme("a1", 0, "widgets"), acme("b1", 5, "gadgets", { actor: "bob" }), acme("a2", 10, "gadgets")];
      expect(shape(stackEvents(events, orgScope))).toEqual([["a1", "a2"], "b1"]);
    });

    it("keeps different organizations apart", () => {
      const events = [acme("a1", 0, "widgets"), comment("h1", 5, { repo: "HelgeSverre/site" }), acme("a2", 10, "gadgets")];
      expect(shape(stackEvents(events, orgScope))).toEqual([["a1", "a2"], "h1"]);
    });

    it("folds an existing repo stack and singles of the same org into one flat stack", () => {
      const events = [acme("w1", 0, "widgets"), acme("w2", 10, "widgets"), acme("g1", 20, "gadgets")];
      const [stack] = stackEvents(events, orgScope) as Stack[];
      expect(flat(stack).map((e) => e.id)).toEqual(["w1", "w2", "g1"]);
      expect(stack.target).toBe("acme");
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("typeStackGroup", () => {
  const ev = (id: string, kind: Kind) => makeEvent({ id, kind, at: "2026-10-22T10:00:00Z" });
  const sing = (id: string, kind: Kind) => single(ev(id, kind));
  const shapeOf = (items: Item[]) =>
    items.map((it) => (isTypeStack(it) ? `${it.kind}*${it.items.length}` : isStack(it) ? "stack" : it.single.id));

  it("folds all events of one kind into one row, placed where the kind first appeared", () => {
    const out = typeStackGroup(
      [sing("s1", "star"), sing("i1", "issue"), sing("s2", "star"), sing("p1", "pr"), sing("s3", "star")],
      1_761_000_000_000,
    );
    expect(shapeOf(out)).toEqual(["star*3", "i1", "p1"]);
  });

  it("builds the type stack from plain events, newest first, keyed by group and kind", () => {
    const events = [
      makeEvent({ id: "s1", kind: "star", at: "2026-10-22T11:00:00Z" }),
      makeEvent({ id: "s2", kind: "star", at: "2026-10-22T09:00:00Z" }),
    ];
    const [stack] = typeStackGroup(events.map(single), 1_761_000_000_000) as TypeStack[];
    expect(stack).toEqual({ typeStack: true, kind: "star", key: "1761000000000|star", at: "2026-10-22T11:00:00Z", items: events });
  });

  it("folds several kinds independently", () => {
    const out = typeStackGroup(
      [sing("s1", "star"), sing("f1", "fork"), sing("s2", "star"), sing("f2", "fork"), sing("i1", "issue")],
      "2026-10-22",
    );
    expect(shapeOf(out)).toEqual(["star*2", "fork*2", "i1"]);
    expect((out[0] as TypeStack).key).toBe("2026-10-22|star");
  });

  it("leaves a kind with a single event alone", () => {
    const out = typeStackGroup([sing("s1", "star"), sing("i1", "issue")], 1);
    expect(out).toEqual([sing("s1", "star"), sing("i1", "issue")]);
  });

  it("passes existing stacks through untouched and does not fold them", () => {
    const stack: Stack = {
      stack: true,
      key: "k",
      target: REPO,
      anchor: 0,
      at: "2026-10-22T10:00:00Z",
      items: [sing("c1", "comment"), sing("c2", "comment")],
    };
    const out = typeStackGroup([sing("c3", "comment"), stack, sing("c4", "comment")], 1);
    expect(shapeOf(out)).toEqual(["comment*2", "stack"]);
    expect(out[1]).toBe(stack);
  });

  it("returns an empty list for an empty group", () => {
    expect(typeStackGroup([], 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("stackSummary", () => {
  const repoScope: StackSettings = { stack: true, stackScope: "repo", stackRepoWindow: 60, stackOrgWindow: 180 };
  const orgScope: StackSettings = { ...repoScope, stackScope: "org" };
  const stackOf = (events: FeedEvent[], s: StackSettings = orgScope) => {
    const [stack] = stackEvents(events, s);
    if (!isStack(stack)) throw new Error("fixture did not stack");
    return stack;
  };
  const opened = (id: string, minutes: number, repo: string) =>
    makeEvent({ id, kind: "issue", state: "OPEN", actor: "alice", repo, created: ago(minutes), at: ago(minutes) });
  const commented = (id: string, minutes: number, repo: string) =>
    makeEvent({ id, kind: "comment", state: "PR", actor: "alice", repo, at: ago(minutes) });
  const merged = (id: string, minutes: number, repo: string) =>
    makeEvent({ id, kind: "pr", state: "MERGED", actor: "alice", repo, created: ago(minutes + 500), at: ago(minutes) });

  it("names the repository when the whole stack is in one", () => {
    const stack = stackOf([opened("i1", 0, "acme/widgets"), opened("i2", 5, "acme/widgets"), opened("i3", 10, "acme/widgets")], repoScope);
    expect(stackSummary(stack)).toEqual({ text: "opened 3 issues", target: "acme/widgets", repos: 1 });
  });

  it("names the repository even when the stack's target is the organization, if every event is in one repository", () => {
    const stack = stackOf([commented("c1", 0, "acme/widgets"), commented("c2", 100, "acme/widgets")]);
    expect(stack.target).toBe("acme");
    expect(stackSummary(stack)).toEqual({ text: "commented 2 times", target: "acme/widgets", repos: 1 });
  });

  it("names the organization and counts repositories when the stack spans several", () => {
    const stack = stackOf([opened("i1", 0, "acme/widgets"), opened("i2", 5, "acme/gadgets"), opened("i3", 10, "acme/gizmos")]);
    expect(stackSummary(stack)).toEqual({ text: "opened 3 issues", target: "acme", repos: 3 });
  });

  it("joins two kinds of activity with 'and'", () => {
    const stack = stackOf([opened("i1", 0, "acme/widgets"), commented("c1", 5, "acme/gadgets")]);
    expect(stackSummary(stack).text).toBe("opened 1 issue and commented 1 time");
  });

  it("joins three or more with commas and a final 'and', in order of first appearance, counting each separately", () => {
    const stack = stackOf([
      opened("i1", 0, "acme/widgets"),
      merged("m1", 5, "acme/gadgets"),
      opened("i2", 10, "acme/widgets"),
      commented("c1", 15, "acme/gizmos"),
      commented("c2", 20, "acme/gizmos"),
    ]);
    expect(stackSummary(stack).text).toBe("opened 2 issues, merged 1 pull request and commented 2 times");
  });

  it("does not merge different review verbs", () => {
    const review = (id: string, minutes: number, state: string, repo: string) =>
      makeEvent({ id, kind: "review", state, actor: "alice", repo, at: ago(minutes) });
    const stack = stackOf([
      review("r1", 0, "APPROVED", "acme/widgets"),
      review("r2", 5, "APPROVED", "acme/gadgets"),
      review("r3", 10, "CHANGES_REQUESTED", "acme/gadgets"),
    ]);
    expect(stackSummary(stack).text).toBe("approved 2 pull requests and requested changes on 1 pull request");
  });

  it("summarises stars and forks of a person across an organization", () => {
    const star = (id: string, minutes: number, repo: string) => makeEvent({ id, kind: "star", actor: "alice", repo, at: ago(minutes) });
    const stack = stackOf([
      star("s1", 0, "acme/widgets"),
      star("s2", 5, "acme/gadgets"),
      makeEvent({ id: "f1", kind: "fork", actor: "alice", repo: "acme/gizmos", at: ago(10) }),
    ]);
    expect(stackSummary(stack)).toEqual({ text: "starred 2 repositories and forked 1 repository", target: "acme", repos: 3 });
  });
});

describe("item helpers", () => {
  const e1 = makeEvent({ id: "e1" });
  const e2 = makeEvent({ id: "e2" });
  const stack: Stack = { stack: true, key: "k", target: REPO, anchor: 0, at: e1.at, items: [single(e1), single(e2)] };
  const typeStack: TypeStack = { typeStack: true, kind: "star", key: "k|star", at: e1.at, items: [e1, e2, makeEvent({ id: "e3" })] };

  it("tells singles, stacks and type stacks apart", () => {
    expect([isStack(single(e1)), isStack(stack), isStack(typeStack)]).toEqual([false, true, false]);
    expect([isTypeStack(single(e1)), isTypeStack(stack), isTypeStack(typeStack)]).toEqual([false, false, true]);
  });

  it("counts the events behind an item", () => {
    expect([itemCount(single(e1)), itemCount(stack), itemCount(typeStack)]).toEqual([1, 2, 3]);
  });

  it("flattens a stack to its events", () => {
    expect(flat(stack)).toEqual([e1, e2]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("start of day / week / month", () => {
  it("startOfDay is local midnight and leaves its argument alone", () => {
    const d = local(2026, 10, 22, 14, 30);
    expect(startOfDay(d)).toEqual(local(2026, 10, 22));
    expect(d).toEqual(local(2026, 10, 22, 14, 30));
  });

  it("startOfWeek goes back to Monday or Sunday depending on the week start", () => {
    expect(startOfWeek(local(2026, 10, 22, 14), 1)).toEqual(local(2026, 10, 19));
    expect(startOfWeek(local(2026, 10, 22, 14), 0)).toEqual(local(2026, 10, 18));
  });

  it("startOfWeek treats Sunday as the last day of a Monday-start week but the first day of a Sunday-start week", () => {
    expect(startOfWeek(local(2026, 10, 25, 12), 1)).toEqual(local(2026, 10, 19));
    expect(startOfWeek(local(2026, 10, 25, 12), 0)).toEqual(local(2026, 10, 25));
  });

  it("startOfWeek returns the day itself on the first day of the week", () => {
    expect(startOfWeek(local(2026, 10, 19, 9), 1)).toEqual(local(2026, 10, 19));
    expect(startOfWeek(local(2026, 10, 18, 9), 0)).toEqual(local(2026, 10, 18));
  });

  it("startOfWeek can cross a month and a year", () => {
    expect(startOfWeek(local(2026, 1, 1, 12), 1)).toEqual(local(2025, 12, 29));
    expect(startOfWeek(local(2026, 3, 1, 12), 1)).toEqual(local(2026, 2, 23));
  });

  it("startOfWeek lands on local midnight across the October daylight-saving change", () => {
    const start = startOfWeek(local(2026, 10, 27, 12), 1);
    expect(start).toEqual(local(2026, 10, 26));
    expect(start.getHours()).toBe(0);
    expect(startOfWeek(local(2026, 10, 25, 23, 59), 1)).toEqual(local(2026, 10, 19));
  });

  it("startOfMonth is midnight on the first", () => {
    expect(startOfMonth(local(2026, 10, 22, 14, 30))).toEqual(local(2026, 10, 1));
    expect(startOfMonth(local(2026, 12, 31, 23, 59))).toEqual(local(2026, 12, 1));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("groupItems", () => {
  const at = (iso: string) => single(makeEvent({ id: iso, at: iso }));
  const startsOf = (groups: ReturnType<typeof groupItems>) => groups.map((g) => g.start);
  const countsOf = (groups: ReturnType<typeof groupItems>) => groups.map((g) => g.items.length);

  it("returns no groups for no items", () => {
    expect(groupItems([], "day", 1)).toEqual([]);
  });

  describe("by day", () => {
    // 00:30 and 23:30 local on either side of midnight in Oslo are 22:30Z and 21:30Z.
    const items = [at("2026-10-22T10:00:00Z"), at("2026-10-21T22:30:00Z"), at("2026-10-21T21:30:00Z"), at("2026-10-20T10:00:00Z")];

    it("splits at local midnight, not at UTC midnight", () => {
      const groups = groupItems(items, "day", 1);
      expect(startsOf(groups)).toEqual([local(2026, 10, 22), local(2026, 10, 21), local(2026, 10, 20)]);
      expect(countsOf(groups)).toEqual([2, 1, 1]);
    });

    it("keys each group by its start time and keeps item order", () => {
      const groups = groupItems(items, "day", 1);
      expect(groups.map((g) => g.key)).toEqual(groups.map((g) => g.start.getTime()));
      expect(groups[0].items).toEqual([items[0], items[1]]);
    });

    it("ignores the week start", () => {
      expect(groupItems(items, "day", 0)).toEqual(groupItems(items, "day", 1));
    });
  });

  describe("by week", () => {
    // Sun 25 Oct 12:00 (after the clocks went back), Mon 19 Oct 00:30, Sun 18 Oct 23:30.
    const items = [at("2026-10-25T11:00:00Z"), at("2026-10-18T22:30:00Z"), at("2026-10-18T21:30:00Z")];

    it("starts weeks on Monday when the week start is 1: Sunday belongs to the week that began the Monday before", () => {
      const groups = groupItems(items, "week", 1);
      expect(startsOf(groups)).toEqual([local(2026, 10, 19), local(2026, 10, 12)]);
      expect(countsOf(groups)).toEqual([2, 1]);
    });

    it("starts weeks on Sunday when the week start is 0: Sunday opens a new week", () => {
      const groups = groupItems(items, "week", 0);
      expect(startsOf(groups)).toEqual([local(2026, 10, 25), local(2026, 10, 18)]);
      expect(countsOf(groups)).toEqual([1, 2]);
    });

    it("puts a whole week, daylight-saving change included, into one group", () => {
      const week = [at("2026-10-25T22:59:00Z"), at("2026-10-25T00:30:00Z"), at("2026-10-24T10:00:00Z"), at("2026-10-19T08:00:00Z")];
      const groups = groupItems(week, "week", 1);
      expect(startsOf(groups)).toEqual([local(2026, 10, 19)]);
      expect(countsOf(groups)).toEqual([4]);
    });
  });

  describe("by month", () => {
    it("splits at the first of the month in local time", () => {
      // 1 Oct 00:30 local is 30 Sep 22:30Z, 30 Sep 23:30 local is 21:30Z.
      const groups = groupItems(
        [at("2026-10-15T10:00:00Z"), at("2026-09-30T22:30:00Z"), at("2026-09-30T21:30:00Z"), at("2026-08-31T10:00:00Z")],
        "month",
        1,
      );
      expect(startsOf(groups)).toEqual([local(2026, 10, 1), local(2026, 9, 1), local(2026, 8, 1)]);
      expect(countsOf(groups)).toEqual([2, 1, 1]);
    });

    it("splits at New Year", () => {
      const groups = groupItems([at("2025-12-31T23:30:00Z"), at("2025-12-31T22:30:00Z")], "month", 1);
      expect(startsOf(groups)).toEqual([local(2026, 1, 1), local(2025, 12, 1)]);
    });
  });

  it("groups stacks and type stacks by their own time", () => {
    const e = makeEvent({ id: "s", at: "2026-10-22T10:00:00Z" });
    const stack: Stack = { stack: true, key: "k", target: REPO, anchor: 0, at: "2026-10-22T10:00:00Z", items: [single(e), single(e)] };
    const typeStack: TypeStack = { typeStack: true, kind: "star", key: "k", at: "2026-10-21T10:00:00Z", items: [e, e] };
    const groups = groupItems([stack, typeStack], "day", 1);
    expect(countsOf(groups)).toEqual([1, 1]);
    expect(groups[0].items[0]).toBe(stack);
  });

  it("only merges neighbours: it relies on the feed being sorted", () => {
    const groups = groupItems([at("2026-10-22T10:00:00Z"), at("2026-10-20T10:00:00Z"), at("2026-10-22T08:00:00Z")], "day", 1);
    expect(countsOf(groups)).toEqual([1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("unitFor", () => {
  it("is hourly for today whatever the grouping", () => {
    for (const g of ["day", "week", "month"] as Group[]) expect(unitFor("today", g)).toBe("hour");
  });
  it("follows the grouping for every other period", () => {
    for (const p of ["7", "30", "90", "180", "365", "all"] as Period[]) {
      expect([unitFor(p, "day"), unitFor(p, "week"), unitFor(p, "month")]).toEqual(["day", "week", "month"]);
    }
  });
});

describe("floorToUnit", () => {
  const d = new Date(2026, 9, 22, 14, 35, 12, 345);

  it("hour: drops minutes, seconds and milliseconds", () => {
    expect(floorToUnit(d, "hour", 1)).toEqual(local(2026, 10, 22, 14));
  });
  it("day: local midnight", () => {
    expect(floorToUnit(d, "day", 1)).toEqual(local(2026, 10, 22));
  });
  it("week: the first day of the week for the chosen week start", () => {
    expect(floorToUnit(d, "week", 1)).toEqual(local(2026, 10, 19));
    expect(floorToUnit(d, "week", 0)).toEqual(local(2026, 10, 18));
  });
  it("month: the first of the month", () => {
    expect(floorToUnit(d, "month", 1)).toEqual(local(2026, 10, 1));
  });
  it("does not modify its argument", () => {
    const copy = new Date(d);
    for (const u of ["hour", "day", "week", "month"] as const) floorToUnit(d, u, 1);
    expect(d).toEqual(copy);
  });
});

describe("bucketList", () => {
  const range = (list: Date[]) => [list[0], list.at(-1)];

  describe("today", () => {
    it("is one bucket per hour from local midnight up to the current hour", () => {
      const buckets = bucketList("today", "day", 1, NOW, 0);
      expect(buckets).toHaveLength(15);
      expect(range(buckets)).toEqual([local(2026, 10, 22, 0), local(2026, 10, 22, 14)]);
      expect(buckets.map((b) => b.getHours())).toEqual([...Array(15).keys()]);
    });

    it("is hourly whatever the grouping, because unitFor makes it so", () => {
      const hourly = bucketList("today", "day", 1, NOW, 0);
      expect(bucketList("today", "week", 0, NOW, 0)).toEqual(hourly);
      expect(bucketList("today", "month", 1, NOW, 0)).toEqual(hourly);
    });

    it("includes the current hour exactly on the hour, and has one bucket just after midnight", () => {
      expect(bucketList("today", "day", 1, local(2026, 10, 22, 14, 0), 0).at(-1)).toEqual(local(2026, 10, 22, 14));
      expect(bucketList("today", "day", 1, local(2026, 10, 22, 0, 5), 0)).toEqual([local(2026, 10, 22, 0)]);
    });
  });

  it("7 days by day: from the day 7 days ago to today", () => {
    const buckets = bucketList("7", "day", 1, NOW, 0);
    expect(buckets).toHaveLength(8);
    expect(range(buckets)).toEqual([local(2026, 10, 15), local(2026, 10, 22)]);
  });

  it("30 days by week: Monday-based weeks that have started by now", () => {
    expect(bucketList("30", "week", 1, NOW, 0)).toEqual([
      local(2026, 9, 21),
      local(2026, 9, 28),
      local(2026, 10, 5),
      local(2026, 10, 12),
      local(2026, 10, 19),
    ]);
  });

  it("30 days by week with Sunday weeks", () => {
    expect(bucketList("30", "week", 0, NOW, 0)).toEqual([
      local(2026, 9, 20),
      local(2026, 9, 27),
      local(2026, 10, 4),
      local(2026, 10, 11),
      local(2026, 10, 18),
    ]);
  });

  it("90 days by month: one bucket per calendar month", () => {
    expect(bucketList("90", "month", 1, NOW, 0)).toEqual([local(2026, 7, 1), local(2026, 8, 1), local(2026, 9, 1), local(2026, 10, 1)]);
  });

  it("all time starts at the bucket holding the earliest event", () => {
    const earliest = Date.parse("2026-08-15T09:00:00Z");
    expect(bucketList("all", "month", 1, NOW, earliest)).toEqual([local(2026, 8, 1), local(2026, 9, 1), local(2026, 10, 1)]);
    expect(bucketList("all", "day", 1, NOW, Date.parse("2026-10-18T09:00:00Z"))).toEqual(
      [18, 19, 20, 21, 22].map((day) => local(2026, 10, day)),
    );
  });

  it("never includes a bucket that starts after now", () => {
    expect(bucketList("30", "week", 1, local(2026, 10, 18, 23, 59), 0).at(-1)).toEqual(local(2026, 10, 12));
    expect(bucketList("30", "week", 1, local(2026, 10, 19, 0, 0), 0).at(-1)).toEqual(local(2026, 10, 19));
  });

  it("steps by local calendar days across the end of daylight-saving time", () => {
    const buckets = bucketList("7", "day", 1, local(2026, 10, 27, 12), 0);
    expect(buckets).toEqual([20, 21, 22, 23, 24, 25, 26, 27].map((day) => local(2026, 10, day)));
    expect(buckets.every((b) => b.getHours() === 0)).toBe(true);
  });

  it("steps by local calendar days across the start of daylight-saving time", () => {
    const buckets = bucketList("7", "day", 1, local(2026, 3, 31, 12), 0);
    expect(buckets).toEqual([24, 25, 26, 27, 28, 29, 30, 31].map((day) => local(2026, 3, day)));
  });

  it("keeps the most recent 400 buckets when the history is longer, so today is never cut off", () => {
    const earliest = local(2023, 1, 1).getTime();
    const buckets = bucketList("all", "day", 1, NOW, earliest);
    expect(buckets).toHaveLength(400);
    expect(buckets.at(-1)).toEqual(local(2026, 10, 22));
    expect(buckets[0]).toEqual(local(2025, 9, 18));
  });

  it("is empty when the earliest time is in the future", () => {
    expect(bucketList("all", "day", 1, NOW, NOW.getTime() + 864e5 * 3)).toEqual([]);
  });
});
