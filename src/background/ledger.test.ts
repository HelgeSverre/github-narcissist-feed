import { afterEach, describe, expect, it, vi } from "vitest";
import { forkNode, makeEvent, makeRepoNode, REPO, starEdge } from "../../tests/helpers/factories";
import type { FeedEvent, RepoLedger } from "../lib/types";
import { diffLedger, EVENT_TTL_DAYS, MAX_EVENTS, mergeEvent, prune } from "./ledger";

const DAY_MS = 864e5;

describe("mergeEvent", () => {
  it("stores an event whose id is new", () => {
    const events: Record<string, FeedEvent> = {};
    const e = makeEvent({ id: "star:a/b:alice", at: "2026-10-22T10:00:00Z" });
    mergeEvent(events, e);
    expect(events).toEqual({ "star:a/b:alice": e });
  });

  it("replaces a stored event with a newer one", () => {
    const old = makeEvent({ id: "issue:u", kind: "issue", at: "2026-10-22T09:00:00Z", state: "OPEN" });
    const newer = makeEvent({ id: "issue:u", kind: "issue", at: "2026-10-22T11:00:00Z", state: "CLOSED" });
    const events = { [old.id]: old };
    mergeEvent(events, newer);
    expect(events[old.id]).toBe(newer);
  });

  it("keeps the stored event when the incoming one is older", () => {
    const stored = makeEvent({ id: "issue:u", kind: "issue", at: "2026-10-22T11:00:00Z", state: "CLOSED" });
    const stale = makeEvent({ id: "issue:u", kind: "issue", at: "2026-10-22T09:00:00Z", state: "OPEN" });
    const events = { [stored.id]: stored };
    mergeEvent(events, stale);
    expect(events[stored.id]).toBe(stored);
  });

  it("lets the incoming event win a tie, so the latest fetch is what is shown", () => {
    const stored = makeEvent({ id: "pr:u", kind: "pr", at: "2026-10-22T10:00:00Z", title: "Before" });
    const incoming = makeEvent({ id: "pr:u", kind: "pr", at: "2026-10-22T10:00:00Z", title: "After" });
    const events = { [stored.id]: stored };
    mergeEvent(events, incoming);
    expect(events[stored.id]).toBe(incoming);
  });

  it("leaves events with other ids alone", () => {
    const other = makeEvent({ id: "star:a/b:bob" });
    const events = { [other.id]: other };
    mergeEvent(events, makeEvent({ id: "star:a/b:alice" }));
    expect(events[other.id]).toBe(other);
    expect(Object.keys(events)).toHaveLength(2);
  });
});

describe("diffLedger", () => {
  const NOW = "2026-10-22T10:15:30.000Z";
  const HOUR = "2026-10-22T10"; // unstar/unfork ids carry the hour, so re-running inside it does not duplicate
  const prevLedger = (over: Partial<RepoLedger> = {}): RepoLedger => ({
    private: false,
    stars: 0,
    forks: 0,
    stargazers: [],
    forkNames: [],
    pushedAt: "2026-10-21T18:00:00Z",
    ...over,
  });
  const run = (repo: ReturnType<typeof makeRepoNode>, prev: RepoLedger) => {
    const events: Record<string, FeedEvent> = {};
    const followUps: { repo: string; n: number }[] = [];
    diffLedger(repo, prev, events, followUps, NOW);
    return { events, followUps };
  };

  describe("stars", () => {
    it("records an unstar for each login that left the window when the count drops", () => {
      const repo = makeRepoNode({
        stargazerCount: 2,
        isPrivate: true,
        stargazers: { edges: [starEdge("alice", "2026-10-01T00:00:00Z"), starEdge("carol", "2026-10-02T00:00:00Z")] },
      });
      const { events, followUps } = run(repo, prevLedger({ stars: 3, stargazers: ["alice", "bob", "carol"] }));
      expect(Object.keys(events)).toEqual([`unstar:${REPO}:bob:${HOUR}`]);
      expect(events[`unstar:${REPO}:bob:${HOUR}`]).toEqual({
        id: `unstar:${REPO}:bob:${HOUR}`,
        kind: "unstar",
        at: NOW,
        repo: REPO,
        private: true,
        actor: "bob",
        avatar: "https://github.com/bob.png?size=40",
        bot: false,
        url: "https://github.com/bob",
        stars: 2,
      });
      expect(followUps).toEqual([]);
    });

    it("records several unstars when several logins disappeared", () => {
      const repo = makeRepoNode({ stargazerCount: 1, stargazers: { edges: [starEdge("alice", "2026-10-01T00:00:00Z")] } });
      const { events } = run(repo, prevLedger({ stars: 3, stargazers: ["alice", "bob", "carol"] }));
      expect(Object.keys(events).toSorted()).toEqual([`unstar:${REPO}:bob:${HOUR}`, `unstar:${REPO}:carol:${HOUR}`]);
    });

    it("records nothing when the count drops but every remembered login is still in the window", () => {
      // The person who left was older than the window; there is no login to name.
      const repo = makeRepoNode({
        stargazerCount: 9,
        stargazers: { edges: [starEdge("alice", "2026-10-01T00:00:00Z"), starEdge("bob", "2026-10-02T00:00:00Z")] },
      });
      const { events, followUps } = run(repo, prevLedger({ stars: 10, stargazers: ["alice", "bob"] }));
      expect(events).toEqual({});
      expect(followUps).toEqual([]);
    });

    it("records nothing for a login swap while the count is unchanged", () => {
      const repo = makeRepoNode({
        stargazerCount: 2,
        stargazers: { edges: [starEdge("alice", "2026-10-01T00:00:00Z"), starEdge("dave", "2026-10-22T00:00:00Z")] },
      });
      const { events, followUps } = run(repo, prevLedger({ stars: 2, stargazers: ["alice", "bob"] }));
      expect(events).toEqual({});
      expect(followUps).toEqual([]);
    });

    it("reuses the id inside the same hour, so a second sweep does not duplicate the unstar", () => {
      const repo = makeRepoNode({ stargazerCount: 0, stargazers: { edges: [] } });
      const prev = prevLedger({ stars: 1, stargazers: ["bob"] });
      const events: Record<string, FeedEvent> = {};
      diffLedger(repo, prev, events, [], NOW);
      diffLedger(repo, prev, events, [], "2026-10-22T10:55:00.000Z");
      expect(Object.keys(events)).toEqual([`unstar:${REPO}:bob:${HOUR}`]);
    });

    it("queues a follow-up when stars jump by more than 5", () => {
      const { events, followUps } = run(makeRepoNode({ stargazerCount: 17 }), prevLedger({ stars: 10 }));
      expect(events).toEqual({});
      expect(followUps).toEqual([{ repo: REPO, n: 7 }]);
    });

    it("does not queue a follow-up for a jump of exactly 5", () => {
      const { followUps } = run(makeRepoNode({ stargazerCount: 15 }), prevLedger({ stars: 10 }));
      expect(followUps).toEqual([]);
    });

    it("caps the follow-up page size at 100", () => {
      const { followUps } = run(makeRepoNode({ stargazerCount: 1010 }), prevLedger({ stars: 10 }));
      expect(followUps).toEqual([{ repo: REPO, n: 100 }]);
    });

    it("does nothing about stars when the stargazers are absent", () => {
      // Token without access to stargazers: GitHub leaves the field out, so neither a drop nor a jump can be judged.
      const dropped = run(
        makeRepoNode({ stargazers: undefined, stargazerCount: 2 }),
        prevLedger({ stars: 10, stargazers: ["alice", "bob"] }),
      );
      expect(dropped.events).toEqual({});
      expect(dropped.followUps).toEqual([]);
      const jumped = run(makeRepoNode({ stargazers: undefined, stargazerCount: 500 }), prevLedger({ stars: 10 }));
      expect(jumped.events).toEqual({});
      expect(jumped.followUps).toEqual([]);
    });
  });

  describe("forks", () => {
    it("records an unfork for each fork that disappeared when the count drops", () => {
      const repo = makeRepoNode({ forkCount: 1, forks: { nodes: [forkNode("carol/github-narcissist-feed", "2026-10-01T00:00:00Z")] } });
      const { events, followUps } = run(
        repo,
        prevLedger({ forks: 2, forkNames: ["carol/github-narcissist-feed", "dave/github-narcissist-feed"] }),
      );
      expect(Object.keys(events)).toEqual([`unfork:dave/github-narcissist-feed:${HOUR}`]);
      expect(events[`unfork:dave/github-narcissist-feed:${HOUR}`]).toEqual({
        id: `unfork:dave/github-narcissist-feed:${HOUR}`,
        kind: "unfork",
        at: NOW,
        repo: REPO,
        private: false,
        actor: "dave",
        avatar: "https://github.com/dave.png?size=40",
        bot: false,
        url: "https://github.com/dave",
        title: "dave/github-narcissist-feed",
        forks: 1,
      });
      expect(followUps).toEqual([]);
    });

    it("records nothing when the fork count is unchanged", () => {
      const repo = makeRepoNode({ forkCount: 1, forks: { nodes: [forkNode("erin/x", "2026-10-22T00:00:00Z")] } });
      const { events } = run(repo, prevLedger({ forks: 1, forkNames: ["dave/x"] }));
      expect(events).toEqual({});
    });

    it("queues a follow-up when forks jump by more than 5, but not for exactly 5", () => {
      expect(run(makeRepoNode({ forkCount: 9 }), prevLedger({ forks: 3 })).followUps).toEqual([{ repo: REPO, n: 6 }]);
      expect(run(makeRepoNode({ forkCount: 8 }), prevLedger({ forks: 3 })).followUps).toEqual([]);
    });

    it("caps the follow-up page size at 100", () => {
      expect(run(makeRepoNode({ forkCount: 300 }), prevLedger({ forks: 0 })).followUps).toEqual([{ repo: REPO, n: 100 }]);
    });

    it("still diffs forks when the stargazers are absent", () => {
      const dropped = run(makeRepoNode({ stargazers: undefined, forkCount: 0 }), prevLedger({ forks: 1, forkNames: ["dave/x"] }));
      expect(Object.keys(dropped.events)).toEqual([`unfork:dave/x:${HOUR}`]);
      expect(run(makeRepoNode({ stargazers: undefined, forkCount: 12 }), prevLedger({ forks: 0 })).followUps).toEqual([
        { repo: REPO, n: 12 },
      ]);
    });
  });

  it("queues the star follow-up before the fork follow-up when both jumped", () => {
    const { followUps } = run(makeRepoNode({ stargazerCount: 30, forkCount: 20 }), prevLedger({ stars: 10, forks: 10 }));
    expect(followUps).toEqual([
      { repo: REPO, n: 20 },
      { repo: REPO, n: 10 },
    ]);
  });

  it("changes nothing when counts are unchanged", () => {
    const repo = makeRepoNode({
      stargazerCount: 2,
      forkCount: 1,
      stargazers: { edges: [starEdge("alice", "2026-10-01T00:00:00Z")] },
      forks: { nodes: [forkNode("carol/x", "2026-10-01T00:00:00Z")] },
    });
    const { events, followUps } = run(repo, prevLedger({ stars: 2, forks: 1, stargazers: ["alice", "bob"], forkNames: ["carol/x"] }));
    expect(events).toEqual({});
    expect(followUps).toEqual([]);
  });
});

describe("prune", () => {
  const NOW = Date.parse("2026-10-22T12:00:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const eventAt = (id: string, ms: number) => makeEvent({ id, at: iso(ms) });
  const byId = (...list: FeedEvent[]) => Object.fromEntries(list.map((e) => [e.id, e]));

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops events older than the TTL and keeps newer ones", () => {
    vi.useFakeTimers({ now: NOW });
    const events = byId(
      eventAt("fresh", NOW - 1 * DAY_MS),
      eventAt("almost", NOW - (EVENT_TTL_DAYS - 1) * DAY_MS),
      eventAt("stale", NOW - (EVENT_TTL_DAYS + 1) * DAY_MS),
    );
    prune(events);
    expect(Object.keys(events).toSorted()).toEqual(["almost", "fresh"]);
  });

  it("keeps an event exactly at the cutoff and drops one a millisecond before it", () => {
    vi.useFakeTimers({ now: NOW });
    const cutoff = NOW - EVENT_TTL_DAYS * DAY_MS;
    const events = byId(eventAt("on-cutoff", cutoff), eventAt("just-before", cutoff - 1));
    prune(events);
    expect(Object.keys(events)).toEqual(["on-cutoff"]);
  });

  it("keeps only the newest MAX_EVENTS when there are more", () => {
    vi.useFakeTimers({ now: NOW });
    const extra = 5;
    const events: Record<string, FeedEvent> = {};
    // e0 is the newest, one minute apart: all well inside the TTL, so only the count limit applies.
    for (let i = 0; i < MAX_EVENTS + extra; i++) events[`e${i}`] = eventAt(`e${i}`, NOW - i * 60_000);
    prune(events);
    expect(Object.keys(events)).toHaveLength(MAX_EVENTS);
    expect(events["e0"]).toBeDefined();
    expect(events[`e${MAX_EVENTS - 1}`]).toBeDefined();
    for (let i = MAX_EVENTS; i < MAX_EVENTS + extra; i++) expect(events[`e${i}`]).toBeUndefined();
  });

  it("applies the TTL to what the count limit would have kept", () => {
    vi.useFakeTimers({ now: NOW });
    const events: Record<string, FeedEvent> = {};
    for (let i = 0; i < MAX_EVENTS; i++) events[`e${i}`] = eventAt(`e${i}`, NOW - i * 60_000);
    events["ancient"] = eventAt("ancient", NOW - (EVENT_TTL_DAYS + 30) * DAY_MS);
    prune(events);
    expect(Object.keys(events)).toHaveLength(MAX_EVENTS);
    expect(events["ancient"]).toBeUndefined();
  });

  it("leaves a small, recent set untouched", () => {
    vi.useFakeTimers({ now: NOW });
    const list = [eventAt("a", NOW), eventAt("b", NOW - DAY_MS), eventAt("c", NOW - 30 * DAY_MS)];
    const events = byId(...list);
    prune(events);
    expect(events).toEqual(byId(...list));
  });

  it("mutates the object it is given and returns nothing", () => {
    vi.useFakeTimers({ now: NOW });
    const events = byId(eventAt("stale", NOW - (EVENT_TTL_DAYS + 1) * DAY_MS));
    const same = events;
    expect(prune(events)).toBeUndefined();
    expect(same).toBe(events);
    expect(events).toEqual({});
  });

  it("does nothing to an empty record", () => {
    const events: Record<string, FeedEvent> = {};
    prune(events);
    expect(events).toEqual({});
  });
});
