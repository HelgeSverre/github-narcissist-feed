import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forkNode,
  makeIssue,
  makePullRequest,
  makeRelease,
  makeRepoNode,
  REPO,
  repoUrl,
  starEdge,
  user,
  bot,
  VIEWER,
  type PullRequestNode,
} from "../../tests/helpers/factories";
import { GitHubError, gql, ledgerOf, normalizeRepo, ownerMetaFrom, peopleFrom, type RepoNode } from "./github";
import type { FeedEvent, Kind, RepoLedger } from "./types";

const byKind = (events: FeedEvent[], kind: Kind) => events.filter((e) => e.kind === kind);
const kindCounts = (events: FeedEvent[]) => events.reduce<Record<string, number>>((n, e) => ({ ...n, [e.kind]: (n[e.kind] ?? 0) + 1 }), {});

const issueComment = (repo: string, number: number, id: number, login: string, createdAt: string) => ({
  createdAt,
  url: `${repoUrl(repo)}/issues/${number}#issuecomment-${id}`,
  author: user(login),
});
const review = (
  repo: string,
  number: number,
  id: number,
  login: string,
  state: string,
  submittedAt: string | null,
): NonNullable<PullRequestNode["reviews"]["nodes"][number]> => ({
  state,
  submittedAt,
  url: `${repoUrl(repo)}/pull/${number}#pullrequestreview-${id}`,
  author: user(login),
});

/** One of everything, with every URL derived from the repository name so two repositories never share an id. */
function richRepo(nameWithOwner = REPO, over: Partial<RepoNode> = {}): RepoNode {
  const url = (path: string) => `${repoUrl(nameWithOwner)}/${path}`;
  return makeRepoNode({
    nameWithOwner,
    stargazerCount: 42,
    forkCount: 7,
    stargazers: { edges: [starEdge("alice", "2026-10-21T08:00:00Z"), starEdge("bob", "2026-10-21T09:30:00Z")] },
    forks: { nodes: [forkNode(`carol/${nameWithOwner.split("/")[1]}`, "2026-10-20T12:00:00Z")] },
    issues: {
      nodes: [
        makeIssue(11, {
          url: url("issues/11"),
          title: "Dark mode flashes on load",
          updatedAt: "2026-10-21T10:00:00Z",
          comments: {
            totalCount: 2,
            nodes: [
              issueComment(nameWithOwner, 11, 1001, "bob", "2026-10-21T09:00:00Z"),
              issueComment(nameWithOwner, 11, 1002, "alice", "2026-10-21T10:00:00Z"),
            ],
          },
        }),
      ],
    },
    pullRequests: {
      nodes: [
        makePullRequest(12, {
          url: url("pull/12"),
          title: "Cache owner metadata",
          updatedAt: "2026-10-21T11:00:00Z",
          author: user("dave"),
          comments: {
            totalCount: 1,
            nodes: [{ createdAt: "2026-10-21T10:30:00Z", url: url("pull/12#issuecomment-2001"), author: user("alice") }],
          },
          reviews: {
            nodes: [
              review(nameWithOwner, 12, 3001, "alice", "APPROVED", "2026-10-21T10:45:00Z"),
              review(nameWithOwner, 12, 3002, "bob", "CHANGES_REQUESTED", "2026-10-21T10:50:00Z"),
            ],
          },
        }),
      ],
    },
    releases: { nodes: [makeRelease("v1.2.0", { url: url("releases/tag/v1.2.0") })] },
    ...over,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
describe("normalizeRepo", () => {
  describe("event mapping", () => {
    it("turns a repository into one event per star, fork, issue, PR, comment, review and release", () => {
      const events = normalizeRepo(richRepo(), VIEWER);
      expect(kindCounts(events)).toEqual({ star: 2, fork: 1, issue: 1, pr: 1, comment: 3, review: 2, release: 1 });
    });

    it("maps a star", () => {
      const [star] = byKind(normalizeRepo(richRepo(), VIEWER), "star");
      expect(star).toEqual({
        id: `star:${REPO}:alice`,
        kind: "star",
        at: "2026-10-21T08:00:00Z",
        actor: "alice",
        avatar: "https://avatars.githubusercontent.com/alice?v=4",
        bot: false,
        url: "https://github.com/HelgeSverre/github-narcissist-feed",
        stars: 42,
        repo: REPO,
        private: false,
      });
    });

    it("maps a fork to the fork's own repository, with the fork count of the parent", () => {
      const [fork] = byKind(normalizeRepo(richRepo(), VIEWER), "fork");
      expect(fork).toEqual({
        id: "fork:carol/github-narcissist-feed",
        kind: "fork",
        at: "2026-10-20T12:00:00Z",
        actor: "carol",
        avatar: "https://avatars.githubusercontent.com/carol?v=4",
        bot: false,
        url: "https://github.com/carol/github-narcissist-feed",
        title: "carol/github-narcissist-feed",
        forks: 7,
        repo: REPO,
        private: false,
      });
    });

    it("maps an issue, sorted by its updatedAt and carrying created/closed and the comment count", () => {
      const r = makeRepoNode({
        issues: {
          nodes: [
            makeIssue(9, {
              title: "Crash on empty token",
              state: "CLOSED",
              createdAt: "2026-10-01T08:00:00Z",
              updatedAt: "2026-10-03T09:00:00Z",
              closedAt: "2026-10-03T09:00:00Z",
              comments: { totalCount: 5, nodes: [] },
              author: user("erin"),
            }),
          ],
        },
      });
      expect(normalizeRepo(r, VIEWER)).toEqual([
        {
          id: `issue:${repoUrl()}/issues/9`,
          kind: "issue",
          at: "2026-10-03T09:00:00Z",
          created: "2026-10-01T08:00:00Z",
          closed: "2026-10-03T09:00:00Z",
          actor: "erin",
          avatar: "https://avatars.githubusercontent.com/erin?v=4",
          bot: false,
          url: `${repoUrl()}/issues/9`,
          title: "Crash on empty token",
          number: 9,
          state: "CLOSED",
          comments: 5,
          repo: REPO,
          private: false,
        },
      ]);
    });

    it("maps comments on an issue and on a PR with the parent's title and number, and tells them apart by state", () => {
      const comments = byKind(normalizeRepo(richRepo(), VIEWER), "comment");
      expect(comments.map((c) => [c.url.split("#")[1], c.state, c.number, c.title, c.actor])).toEqual([
        ["issuecomment-1001", "ISSUE", 11, "Dark mode flashes on load", "bob"],
        ["issuecomment-1002", "ISSUE", 11, "Dark mode flashes on load", "alice"],
        ["issuecomment-2001", "PR", 12, "Cache owner metadata", "alice"],
      ]);
      expect(comments[0].at).toBe("2026-10-21T09:00:00Z");
    });

    it("maps a review to its submission time and state", () => {
      const reviews = byKind(normalizeRepo(richRepo(), VIEWER), "review");
      expect(reviews.map((v) => [v.actor, v.state, v.at, v.number, v.title])).toEqual([
        ["alice", "APPROVED", "2026-10-21T10:45:00Z", 12, "Cache owner metadata"],
        ["bob", "CHANGES_REQUESTED", "2026-10-21T10:50:00Z", 12, "Cache owner metadata"],
      ]);
    });

    it("copies the repository name and privacy onto every event", () => {
      const events = normalizeRepo(richRepo("acme/internal-tools", { isPrivate: true }), VIEWER);
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.repo === "acme/internal-tools" && e.private === true)).toBe(true);
    });

    it("returns nothing for a repository with no activity", () => {
      expect(normalizeRepo(makeRepoNode(), VIEWER)).toEqual([]);
    });
  });

  describe("pull request state", () => {
    const stateOf = (over: Partial<PullRequestNode>) =>
      normalizeRepo(makeRepoNode({ pullRequests: { nodes: [makePullRequest(5, over)] } }), VIEWER)[0].state;

    it("reports an open draft as DRAFT", () => {
      expect(stateOf({ state: "OPEN", isDraft: true })).toBe("DRAFT");
    });
    it("reports an open non-draft as OPEN", () => {
      expect(stateOf({ state: "OPEN", isDraft: false })).toBe("OPEN");
    });
    it("keeps CLOSED for a draft that was closed without merging", () => {
      expect(stateOf({ state: "CLOSED", isDraft: true, closedAt: "2026-10-21T00:00:00Z" })).toBe("CLOSED");
    });
    it("keeps MERGED and exposes mergedAt and closedAt", () => {
      const [pr] = normalizeRepo(
        makeRepoNode({
          pullRequests: {
            nodes: [makePullRequest(6, { state: "MERGED", mergedAt: "2026-10-21T12:00:00Z", closedAt: "2026-10-21T12:00:00Z" })],
          },
        }),
        VIEWER,
      );
      expect(pr).toMatchObject({ kind: "pr", state: "MERGED", merged: "2026-10-21T12:00:00Z", closed: "2026-10-21T12:00:00Z" });
    });
  });

  describe("bot detection", () => {
    const repoWithBots = () =>
      makeRepoNode({
        issues: {
          nodes: [
            makeIssue(1, {
              author: bot("dependabot"),
              comments: {
                totalCount: 1,
                nodes: [{ ...issueComment(REPO, 1, 1, "github-actions", "2026-10-21T08:00:00Z"), author: bot("github-actions") }],
              },
            }),
          ],
        },
        pullRequests: {
          nodes: [
            makePullRequest(2, {
              author: bot("renovate"),
              comments: {
                totalCount: 1,
                nodes: [{ createdAt: "2026-10-21T08:00:00Z", url: `${repoUrl()}/pull/2#issuecomment-5`, author: user("alice") }],
              },
              reviews: {
                nodes: [
                  { ...review(REPO, 2, 7, "x", "COMMENTED", "2026-10-21T09:00:00Z"), author: bot("copilot-pull-request-reviewer") },
                  review(REPO, 2, 8, "alice", "APPROVED", "2026-10-21T09:30:00Z"),
                ],
              },
            }),
          ],
        },
      });

    it("flags issues, PRs, comments and reviews authored by a Bot actor", () => {
      const events = normalizeRepo(repoWithBots(), VIEWER);
      const flagged = events.filter((e) => e.bot).map((e) => `${e.kind}:${e.actor}`);
      expect(flagged).toEqual(["issue:dependabot", "comment:github-actions", "pr:renovate", "review:copilot-pull-request-reviewer"]);
    });

    it("does not flag humans, including a human commenting on a bot's PR", () => {
      const humans = normalizeRepo(repoWithBots(), VIEWER).filter((e) => !e.bot);
      expect(humans.map((e) => `${e.kind}:${e.actor}`)).toEqual(["comment:alice", "review:alice"]);
    });

    it("treats an actor without __typename as human", () => {
      const r = makeRepoNode({ issues: { nodes: [makeIssue(1, { author: { login: "frank", avatarUrl: "" } })] } });
      expect(normalizeRepo(r, VIEWER)[0].bot).toBe(false);
    });

    it("never flags stars, forks or releases", () => {
      const events = normalizeRepo(richRepo(), VIEWER);
      expect(events.filter((e) => ["star", "fork", "release"].includes(e.kind)).every((e) => !e.bot)).toBe(true);
    });
  });

  describe("deleted users", () => {
    it("attributes an issue, PR, comment and review with a null author to ghost", () => {
      const r = makeRepoNode({
        issues: {
          nodes: [
            makeIssue(1, {
              author: null,
              comments: {
                totalCount: 1,
                nodes: [{ createdAt: "2026-10-21T08:00:00Z", url: `${repoUrl()}/issues/1#issuecomment-1`, author: null }],
              },
            }),
          ],
        },
        pullRequests: {
          nodes: [
            makePullRequest(2, {
              author: user("alice"),
              reviews: {
                nodes: [
                  { state: "APPROVED", submittedAt: "2026-10-21T09:00:00Z", url: `${repoUrl()}/pull/2#pullrequestreview-1`, author: null },
                ],
              },
            }),
          ],
        },
      });
      const events = normalizeRepo(r, VIEWER);
      expect(events.map((e) => [e.kind, e.actor, e.avatar, e.bot])).toEqual([
        ["issue", "ghost", "", false],
        ["comment", "ghost", "", false],
        ["pr", "alice", "https://avatars.githubusercontent.com/alice?v=4", false],
        ["review", "ghost", "", false],
      ]);
    });
  });

  describe("reviews", () => {
    const reviewsFor = (author: PullRequestNode["author"], reviews: PullRequestNode["reviews"]["nodes"]) =>
      byKind(
        normalizeRepo(makeRepoNode({ pullRequests: { nodes: [makePullRequest(3, { author, reviews: { nodes: reviews } })] } }), VIEWER),
        "review",
      );

    it("drops COMMENTED reviews written by the PR author on their own PR", () => {
      const out = reviewsFor(user("dave"), [
        review(REPO, 3, 1, "dave", "COMMENTED", "2026-10-21T08:00:00Z"),
        review(REPO, 3, 2, "bob", "APPROVED", "2026-10-21T09:00:00Z"),
      ]);
      expect(out.map((v) => [v.actor, v.state])).toEqual([["bob", "APPROVED"]]);
    });

    it("keeps COMMENTED reviews written by someone else", () => {
      const out = reviewsFor(user("dave"), [review(REPO, 3, 1, "bob", "COMMENTED", "2026-10-21T08:00:00Z")]);
      expect(out.map((v) => [v.actor, v.state])).toEqual([["bob", "COMMENTED"]]);
    });

    it("only drops the COMMENTED ones: other states from the PR author stay", () => {
      const out = reviewsFor(user("dave"), [review(REPO, 3, 1, "dave", "DISMISSED", "2026-10-21T08:00:00Z")]);
      expect(out.map((v) => v.state)).toEqual(["DISMISSED"]);
    });

    it("skips pending reviews that have no submittedAt", () => {
      expect(reviewsFor(user("dave"), [review(REPO, 3, 1, "bob", "PENDING", null)])).toEqual([]);
    });
  });

  describe("releases", () => {
    const releaseOf = (rel: ReturnType<typeof makeRelease>) =>
      byKind(normalizeRepo(makeRepoNode({ releases: { nodes: [rel] } }), VIEWER), "release")[0];

    it("uses the release name as title, publishedAt as time and the tag as tag", () => {
      expect(releaseOf(makeRelease("v2.0.0", { name: "Narcissist 2.0", publishedAt: "2026-10-18T08:05:00Z" }))).toEqual({
        id: `release:${repoUrl()}/releases/tag/v2.0.0`,
        kind: "release",
        at: "2026-10-18T08:05:00Z",
        actor: VIEWER,
        avatar: "https://avatars.githubusercontent.com/HelgeSverre?v=4",
        bot: false,
        url: `${repoUrl()}/releases/tag/v2.0.0`,
        title: "Narcissist 2.0",
        tag: "v2.0.0",
        repo: REPO,
        private: false,
      });
    });

    it("falls back to the tag name when the release has no name", () => {
      expect(releaseOf(makeRelease("v2.0.1", { name: null })).title).toBe("v2.0.1");
      expect(releaseOf(makeRelease("v2.0.2", { name: "" })).title).toBe("v2.0.2");
    });

    it("falls back to createdAt when the release is not published yet", () => {
      expect(releaseOf(makeRelease("v2.1.0-rc.1", { publishedAt: null, createdAt: "2026-10-19T07:00:00Z" })).at).toBe(
        "2026-10-19T07:00:00Z",
      );
    });

    it("attributes a release without an author to the viewer", () => {
      expect(releaseOf(makeRelease("v2.2.0", { author: null }))).toMatchObject({ actor: VIEWER, avatar: "" });
    });
  });

  describe("null entries in GraphQL lists", () => {
    // GitHub returns null for nodes the token cannot see (private forks, blocked or deleted accounts, partial permission errors).
    const nullIn: [string, () => RepoNode, Kind[]][] = [
      ["stargazer edges", () => makeRepoNode({ stargazers: { edges: [null, starEdge("alice", "2026-10-21T08:00:00Z")] } }), ["star"]],
      [
        "stargazer edges whose node is null",
        () =>
          makeRepoNode({
            stargazers: { edges: [{ starredAt: "2026-10-21T07:00:00Z", node: null }, starEdge("alice", "2026-10-21T08:00:00Z")] },
          }),
        ["star"],
      ],
      ["forks", () => makeRepoNode({ forks: { nodes: [null, forkNode("carol/narcissist", "2026-10-20T12:00:00Z")] } }), ["fork"]],
      ["issues", () => makeRepoNode({ issues: { nodes: [null, makeIssue(1)] } }), ["issue"]],
      [
        "issue comments",
        () =>
          makeRepoNode({
            issues: {
              nodes: [
                makeIssue(1, { comments: { totalCount: 2, nodes: [null, issueComment(REPO, 1, 1, "bob", "2026-10-21T08:00:00Z")] } }),
              ],
            },
          }),
        ["issue", "comment"],
      ],
      ["pull requests", () => makeRepoNode({ pullRequests: { nodes: [null, makePullRequest(2)] } }), ["pr"]],
      [
        "pull request comments",
        () =>
          makeRepoNode({
            pullRequests: {
              nodes: [
                makePullRequest(2, {
                  comments: {
                    totalCount: 2,
                    nodes: [null, { createdAt: "2026-10-21T08:00:00Z", url: `${repoUrl()}/pull/2#issuecomment-9`, author: user("bob") }],
                  },
                }),
              ],
            },
          }),
        ["pr", "comment"],
      ],
      [
        "reviews",
        () =>
          makeRepoNode({
            pullRequests: {
              nodes: [makePullRequest(2, { reviews: { nodes: [null, review(REPO, 2, 1, "bob", "APPROVED", "2026-10-21T08:00:00Z")] } })],
            },
          }),
        ["pr", "review"],
      ],
      ["releases", () => makeRepoNode({ releases: { nodes: [null, makeRelease("v1.0.0")] } }), ["release"]],
    ];

    it.each(nullIn)("skips null %s and keeps the rest", (_name, build, kinds) => {
      let events: FeedEvent[] = [];
      expect(() => (events = normalizeRepo(build(), VIEWER))).not.toThrow();
      expect(events.map((e) => e.kind)).toEqual(kinds);
    });

    it("survives null entries in every list at once", () => {
      const r = richRepo();
      r.stargazers!.edges.unshift(null, { starredAt: "2026-10-21T07:00:00Z", node: null });
      r.forks.nodes.unshift(null);
      r.issues.nodes.unshift(null);
      r.issues.nodes[1]!.comments.nodes.unshift(null);
      r.pullRequests.nodes.unshift(null);
      r.pullRequests.nodes[1]!.comments.nodes.unshift(null);
      r.pullRequests.nodes[1]!.reviews.nodes.unshift(null);
      r.releases.nodes.unshift(null);
      expect(normalizeRepo(r, VIEWER)).toEqual(normalizeRepo(richRepo(), VIEWER));
    });

    it("keeps a fork whose owner is null and attributes it to the owner part of the fork's name", () => {
      const r = makeRepoNode({
        forkCount: 1,
        forks: { nodes: [{ nameWithOwner: "carol/narcissist", createdAt: "2026-10-20T12:00:00Z", owner: null }] },
      });
      expect(normalizeRepo(r, VIEWER)).toEqual([
        {
          id: "fork:carol/narcissist",
          kind: "fork",
          at: "2026-10-20T12:00:00Z",
          actor: "carol",
          avatar: "",
          bot: false,
          url: "https://github.com/carol/narcissist",
          title: "carol/narcissist",
          forks: 1,
          repo: REPO,
          private: false,
        },
      ]);
    });
  });

  describe("token without stargazer access", () => {
    // Fine-grained tokens without Contents access make GitHub omit `stargazers` (the query skips it via @include(if:$stars)).
    const withoutStars = () => richRepo(REPO, { stargazers: undefined });

    it("produces every other event and no stars", () => {
      const events = normalizeRepo(withoutStars(), VIEWER);
      expect(byKind(events, "star")).toEqual([]);
      expect(kindCounts(events)).toEqual({ fork: 1, issue: 1, pr: 1, comment: 3, review: 2, release: 1 });
    });

    it("produces the same non-star events as with access", () => {
      const withAccess = normalizeRepo(richRepo(), VIEWER).filter((e) => e.kind !== "star");
      expect(normalizeRepo(withoutStars(), VIEWER)).toEqual(withAccess);
    });
  });

  describe("event ids", () => {
    it("are stable: normalising the same data twice gives the same ids in the same order", () => {
      const first = normalizeRepo(richRepo(), VIEWER).map((e) => e.id);
      const second = normalizeRepo(richRepo(), VIEWER).map((e) => e.id);
      expect(second).toEqual(first);
    });

    it("are unique within a repository", () => {
      const ids = normalizeRepo(richRepo(), VIEWER).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("are unique across repositories that have the same people and numbers", () => {
      const ids = [
        ...normalizeRepo(richRepo("HelgeSverre/github-narcissist-feed"), VIEWER),
        ...normalizeRepo(richRepo("HelgeSverre/other-repo"), VIEWER),
      ].map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("do not change when a later page of activity adds events", () => {
      const before = normalizeRepo(richRepo(), VIEWER).map((e) => e.id);
      const grown = richRepo();
      grown.stargazers!.edges.push(starEdge("zed", "2026-10-22T08:00:00Z"));
      const after = normalizeRepo(grown, VIEWER).map((e) => e.id);
      expect(after).toEqual(expect.arrayContaining(before));
      expect(after).toContain(`star:${REPO}:zed`);
    });

    it("tell an issue and a PR with the same number apart", () => {
      const r = makeRepoNode({ issues: { nodes: [makeIssue(7)] }, pullRequests: { nodes: [makePullRequest(7)] } });
      expect(normalizeRepo(r, VIEWER).map((e) => e.id)).toEqual([`issue:${repoUrl()}/issues/7`, `pr:${repoUrl()}/pull/7`]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ledgerOf", () => {
  it("records counts, privacy, push time, stargazer logins and fork names", () => {
    const r = richRepo(REPO, { isPrivate: true, pushedAt: "2026-10-21T18:00:00Z" });
    expect(ledgerOf(r)).toEqual({
      private: true,
      stars: 42,
      forks: 7,
      stargazers: ["alice", "bob"],
      forkNames: ["carol/github-narcissist-feed"],
      pushedAt: "2026-10-21T18:00:00Z",
    });
  });

  it("skips null stargazer edges and nodes and null forks", () => {
    const r = makeRepoNode({
      stargazerCount: 3,
      stargazers: { edges: [null, { starredAt: "2026-10-21T07:00:00Z", node: null }, starEdge("alice", "2026-10-21T08:00:00Z")] },
      forks: { nodes: [null, forkNode("carol/narcissist", "2026-10-20T12:00:00Z")] },
    });
    expect(ledgerOf(r)).toMatchObject({ stars: 3, stargazers: ["alice"], forkNames: ["carol/narcissist"] });
  });

  it("keeps a fork whose owner is null in forkNames", () => {
    const r = makeRepoNode({ forks: { nodes: [{ nameWithOwner: "carol/narcissist", createdAt: "2026-10-20T12:00:00Z", owner: null }] } });
    expect(ledgerOf(r).forkNames).toEqual(["carol/narcissist"]);
  });

  describe("when the token cannot list stargazers", () => {
    const prev: RepoLedger = {
      private: false,
      stars: 40,
      forks: 7,
      stargazers: ["alice", "zoe"],
      forkNames: ["carol/github-narcissist-feed"],
      pushedAt: "2026-10-01T00:00:00Z",
    };
    const noAccess = () => richRepo(REPO, { stargazers: undefined, stargazerCount: 41 });

    it("keeps prev.stargazers instead of wiping them (which would later read as everyone unstarring)", () => {
      expect(ledgerOf(noAccess(), prev).stargazers).toEqual(["alice", "zoe"]);
    });

    it("still takes the live counts, fork names and push time from the response", () => {
      expect(ledgerOf(noAccess(), prev)).toEqual({
        private: false,
        stars: 41,
        forks: 7,
        stargazers: ["alice", "zoe"],
        forkNames: ["carol/github-narcissist-feed"],
        pushedAt: "2026-10-21T18:00:00Z",
      });
    });

    it("gives an empty list when there is no previous ledger either", () => {
      expect(ledgerOf(noAccess()).stargazers).toEqual([]);
    });
  });

  it("replaces prev.stargazers when the response does list stargazers, even an empty list", () => {
    const prev: RepoLedger = { private: false, stars: 1, forks: 0, stargazers: ["zoe"], forkNames: [] };
    expect(ledgerOf(makeRepoNode({ stargazers: { edges: [] } }), prev).stargazers).toEqual([]);
    expect(ledgerOf(richRepo(), prev).stargazers).toEqual(["alice", "bob"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ownerMetaFrom", () => {
  it("returns null when GitHub found no such owner", () => {
    expect(ownerMetaFrom("ghost-org", null, VIEWER)).toBeNull();
  });

  it("maps a user and grants private access only to the viewer themselves", () => {
    const node = { __typename: "User", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4", repositories: { totalCount: 31 } };
    expect(ownerMetaFrom("HelgeSverre", node, VIEWER)).toEqual({
      login: "HelgeSverre",
      type: "user",
      avatar: node.avatarUrl,
      privateAccess: true,
      repoCount: 31,
    });
    expect(ownerMetaFrom("torvalds", node, VIEWER)).toMatchObject({ type: "user", privateAccess: false });
  });

  it("compares the viewer's login case-insensitively", () => {
    expect(ownerMetaFrom("helgesverre", { __typename: "User", avatarUrl: "" }, "HelgeSverre")?.privateAccess).toBe(true);
  });

  it("maps an organization and grants private access to members only", () => {
    const org = {
      __typename: "Organization",
      avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
      viewerIsAMember: true,
      repositories: { totalCount: 12 },
    };
    expect(ownerMetaFrom("acme", org, VIEWER)).toEqual({
      login: "acme",
      type: "org",
      avatar: org.avatarUrl,
      privateAccess: true,
      repoCount: 12,
    });
    expect(ownerMetaFrom("acme", { ...org, viewerIsAMember: false }, VIEWER)?.privateAccess).toBe(false);
    expect(ownerMetaFrom("acme", { ...org, viewerIsAMember: undefined }, VIEWER)?.privateAccess).toBe(false);
  });

  it("does not give an organization private access just because its login equals the viewer's", () => {
    expect(ownerMetaFrom(VIEWER, { __typename: "Organization", avatarUrl: "", viewerIsAMember: false }, VIEWER)?.privateAccess).toBe(false);
  });

  it("treats a node without __typename as a user and leaves repoCount undefined without repositories", () => {
    expect(ownerMetaFrom("someone", { avatarUrl: "" }, VIEWER)).toEqual({
      login: "someone",
      type: "user",
      avatar: "",
      privateAccess: false,
      repoCount: undefined,
    });
  });
});

describe("peopleFrom", () => {
  const viewer = {
    organizations: {
      nodes: [
        { login: "acme", avatarUrl: "a.png", viewerIsAMember: true },
        { login: "oss-club", avatarUrl: "o.png", viewerIsAMember: false },
      ],
    },
    following: {
      nodes: [
        { login: "torvalds", avatarUrl: "t.png" },
        { login: "gaearon", avatarUrl: "g.png" },
      ],
    },
  };

  it("lists organizations first, then followed users, each with its group", () => {
    expect(peopleFrom(viewer)).toEqual([
      { login: "acme", avatar: "a.png", type: "org", group: "Your organizations", privateAccess: true },
      { login: "oss-club", avatar: "o.png", type: "org", group: "Your organizations", privateAccess: false },
      { login: "torvalds", avatar: "t.png", type: "user", group: "People you follow", privateAccess: false },
      { login: "gaearon", avatar: "g.png", type: "user", group: "People you follow", privateAccess: false },
    ]);
  });

  it("returns an empty list when the viewer has no organizations and follows nobody", () => {
    expect(peopleFrom({ organizations: { nodes: [] }, following: { nodes: [] } })).toEqual([]);
  });

  it("copes with only one of the two lists being populated", () => {
    expect(peopleFrom({ organizations: { nodes: [] }, following: viewer.following }).map((p) => p.group)).toEqual([
      "People you follow",
      "People you follow",
    ]);
    expect(peopleFrom({ organizations: viewer.organizations, following: { nodes: [] } }).map((p) => p.type)).toEqual(["org", "org"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("gql", () => {
  const TOKEN = "ghp_unit_test_token";
  const QUERY = "query { viewer { login } }";
  const RATE = { cost: 1, remaining: 4999, limit: 5000, resetAt: "2026-10-22T13:00:00Z" };

  const ok = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers });
  const status = (code: number, headers: Record<string, string> = {}) => new Response("{}", { status: code, headers });

  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("request", () => {
    it("POSTs the query and variables to the GraphQL endpoint with the bearer token", async () => {
      fetchMock.mockResolvedValueOnce(ok({ data: { viewer: { login: VIEWER } } }));
      await gql(TOKEN, QUERY, { owner: "acme" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.github.com/graphql");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
      expect(JSON.parse(init?.body as string)).toEqual({ query: QUERY, variables: { owner: "acme" } });
    });

    it("sends empty variables by default", async () => {
      fetchMock.mockResolvedValueOnce(ok({ data: {} }));
      await gql(TOKEN, QUERY);
      expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).variables).toEqual({});
    });
  });

  describe("result", () => {
    it("returns data and the rate limit GitHub reported", async () => {
      fetchMock.mockResolvedValueOnce(ok({ data: { rateLimit: RATE, viewer: { login: VIEWER } } }));
      const res = await gql<{ viewer: { login: string } }>(TOKEN, QUERY);
      expect(res.data.viewer.login).toBe(VIEWER);
      expect(res.rateLimit).toEqual(RATE);
      expect(res.errors).toBeUndefined();
    });

    it("converts the token expiration header to an ISO timestamp, and null when GitHub sends none", async () => {
      fetchMock.mockResolvedValueOnce(ok({ data: {} }, { "github-authentication-token-expiration": "2026-12-01 10:00:00 UTC" }));
      expect((await gql(TOKEN, QUERY)).tokenExpiresAt).toBe("2026-12-01T10:00:00.000Z");
      fetchMock.mockResolvedValueOnce(ok({ data: {} }, { "github-authentication-token-expiration": "2026-12-01 10:00:00 -0500" }));
      expect((await gql(TOKEN, QUERY)).tokenExpiresAt).toBe("2026-12-01T15:00:00.000Z");
      fetchMock.mockResolvedValueOnce(ok({ data: {} }));
      expect((await gql(TOKEN, QUERY)).tokenExpiresAt).toBeNull();
    });

    it("returns partial data together with the errors when GitHub reports both", async () => {
      const errors = [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token", path: ["nodes", 0, "stargazers"] }];
      const data = { rateLimit: RATE, nodes: [{ nameWithOwner: REPO, stargazerCount: 3 }, null] };
      fetchMock.mockResolvedValueOnce(ok({ data, errors }));
      const res = await gql<typeof data>(TOKEN, QUERY);
      expect(res.data).toEqual(data);
      expect(res.errors).toEqual(errors);
      expect(res.rateLimit).toEqual(RATE);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("failures", () => {
    it("turns a 401 into an auth error and does not retry", async () => {
      fetchMock.mockResolvedValue(status(401));
      const err = await gql(TOKEN, QUERY).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GitHubError);
      expect(err).toMatchObject({ kind: "auth", status: 401 });
      expect((err as Error).message).toContain("401");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("turns a network failure into a network error", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(gql(TOKEN, QUERY)).rejects.toMatchObject({
        kind: "network",
        message: "Network error: Failed to fetch",
        status: undefined,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws a server error for other HTTP failures without retrying", async () => {
      fetchMock.mockResolvedValue(status(500));
      await expect(gql(TOKEN, QUERY)).rejects.toMatchObject({ kind: "server", status: 500, message: "GitHub returned HTTP 500" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws a graphql error when GitHub returns errors and no data", async () => {
      fetchMock.mockResolvedValue(
        ok({ errors: [{ type: "NOT_FOUND", message: "Could not resolve to a User with the login of 'nobody'." }] }),
      );
      await expect(gql(TOKEN, QUERY)).rejects.toMatchObject({
        kind: "graphql",
        message: "Could not resolve to a User with the login of 'nobody'.",
      });
    });

    it("throws an auth error when the only error is FORBIDDEN", async () => {
      fetchMock.mockResolvedValue(ok({ errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] }));
      await expect(gql(TOKEN, QUERY)).rejects.toMatchObject({ kind: "auth" });
    });
  });

  describe("secondary rate limit (403 / 429)", () => {
    it("waits for retry-after and retries a 403", async () => {
      fetchMock
        .mockResolvedValueOnce(status(403, { "retry-after": "2" }))
        .mockResolvedValueOnce(ok({ data: { viewer: { login: VIEWER } } }));
      const pending = gql<{ viewer: { login: string } }>(TOKEN, QUERY);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).data.viewer.login).toBe(VIEWER);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("treats a 429 the same way", async () => {
      fetchMock.mockResolvedValueOnce(status(429, { "retry-after": "1" })).mockResolvedValueOnce(ok({ data: { ok: true } }));
      const pending = gql(TOKEN, QUERY);
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await pending).data).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("gives up with a rate error after two retries", async () => {
      fetchMock.mockImplementation(async () => status(403, { "retry-after": "1" }));
      // oxlint-disable-next-line vitest/valid-expect -- awaited below, after the fake timers advance
      const failed = expect(gql(TOKEN, QUERY)).rejects.toMatchObject({ kind: "rate", status: 403 });
      await vi.runAllTimersAsync();
      await failed;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does not retry a 403 without retry-after (the hourly limit or a permission problem)", async () => {
      fetchMock.mockResolvedValue(status(403));
      await expect(gql(TOKEN, QUERY)).rejects.toMatchObject({ kind: "rate", status: 403 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not wait longer than 60 seconds", async () => {
      fetchMock.mockResolvedValue(status(403, { "retry-after": "61" }));
      await expect(gql(TOKEN, QUERY)).rejects.toMatchObject({ kind: "rate" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("gateway errors (502 / 503 / 504)", () => {
    it("retries a 502 after 800 ms and returns the successful response", async () => {
      fetchMock.mockResolvedValueOnce(status(502)).mockResolvedValueOnce(ok({ data: { viewer: { login: VIEWER } } }));
      const pending = gql<{ viewer: { login: string } }>(TOKEN, QUERY);
      await vi.advanceTimersByTimeAsync(799);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).data.viewer.login).toBe(VIEWER);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([503, 504])("retries a %i too", async (code) => {
      fetchMock.mockResolvedValueOnce(status(code)).mockResolvedValueOnce(ok({ data: { ok: true } }));
      const pending = gql(TOKEN, QUERY);
      await vi.advanceTimersByTimeAsync(800);
      expect((await pending).data).toEqual({ ok: true });
    });

    it("backs off exponentially (800, 1600, 3200 ms) and then reports a server error", async () => {
      fetchMock.mockImplementation(async () => status(502));
      // oxlint-disable-next-line vitest/valid-expect -- awaited below, after the fake timers advance
      const failed = expect(gql(TOKEN, QUERY)).rejects.toMatchObject({ kind: "server", status: 502, message: "GitHub returned HTTP 502" });
      await vi.advanceTimersByTimeAsync(800);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1_599);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(3_200);
      await failed;
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("retries again from scratch when the second attempt hits a rate limit", async () => {
      fetchMock
        .mockResolvedValueOnce(status(502))
        .mockResolvedValueOnce(status(403, { "retry-after": "1" }))
        .mockResolvedValueOnce(ok({ data: { ok: true } }));
      const pending = gql(TOKEN, QUERY);
      await vi.advanceTimersByTimeAsync(800 + 1_000);
      expect((await pending).data).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
