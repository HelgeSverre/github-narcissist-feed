/**
 * Builders for unit-test fixtures. Every builder returns a complete, realistic object and takes a partial override,
 * so a test states only what it cares about and the rest stays plausible.
 */
import type { RepoNode } from "../../src/lib/github";
import type { FeedEvent } from "../../src/lib/types";

export const VIEWER = "HelgeSverre";
export const REPO = "HelgeSverre/github-narcissist-feed";
export const repoUrl = (nameWithOwner = REPO) => `https://github.com/${nameWithOwner}`;

type Node<K extends "issues" | "pullRequests" | "releases"> = NonNullable<RepoNode[K]["nodes"][number]>;
export type IssueNode = Node<"issues">;
export type PullRequestNode = Node<"pullRequests">;
export type ReleaseNode = Node<"releases">;
export type ForkNode = NonNullable<RepoNode["forks"]["nodes"][number]>;
export type StarEdge = NonNullable<NonNullable<RepoNode["stargazers"]>["edges"][number]>;
type Actor = NonNullable<IssueNode["author"]>;

export const user = (login: string): Actor => ({
  __typename: "User",
  login,
  avatarUrl: `https://avatars.githubusercontent.com/${login}?v=4`,
});
export const bot = (login: string): Actor => ({
  __typename: "Bot",
  login,
  avatarUrl: `https://avatars.githubusercontent.com/in/${login}?v=4`,
});

export function makeEvent(over: Partial<FeedEvent> = {}): FeedEvent {
  const e: FeedEvent = {
    id: "",
    kind: "star",
    at: "2026-10-22T10:00:00Z",
    repo: REPO,
    private: false,
    actor: "alice",
    avatar: "https://avatars.githubusercontent.com/alice?v=4",
    bot: false,
    url: repoUrl(),
    ...over,
  };
  return { ...e, id: over.id ?? `${e.kind}:${e.repo}:${e.actor}:${e.at}:${e.state ?? ""}` };
}

export const starEdge = (login: string, starredAt: string): StarEdge => ({
  starredAt,
  node: { login, avatarUrl: `https://avatars.githubusercontent.com/${login}?v=4` },
});

export const forkNode = (nameWithOwner: string, createdAt: string): ForkNode => {
  const [owner] = nameWithOwner.split("/");
  return { nameWithOwner, createdAt, owner: user(owner) };
};

export function makeIssue(number: number, over: Partial<IssueNode> = {}): IssueNode {
  return {
    number,
    title: `Issue ${number}`,
    state: "OPEN",
    createdAt: "2026-10-20T09:00:00Z",
    updatedAt: "2026-10-20T09:00:00Z",
    closedAt: null,
    url: `${repoUrl()}/issues/${number}`,
    author: user("alice"),
    comments: { totalCount: 0, nodes: [] },
    ...over,
  };
}

export function makePullRequest(number: number, over: Partial<PullRequestNode> = {}): PullRequestNode {
  return {
    number,
    title: `Pull request ${number}`,
    state: "OPEN",
    isDraft: false,
    createdAt: "2026-10-20T09:00:00Z",
    updatedAt: "2026-10-20T09:00:00Z",
    mergedAt: null,
    closedAt: null,
    url: `${repoUrl()}/pull/${number}`,
    author: user("alice"),
    additions: 12,
    deletions: 3,
    comments: { totalCount: 0, nodes: [] },
    reviews: { nodes: [] },
    ...over,
  };
}

export function makeRelease(tagName: string, over: Partial<ReleaseNode> = {}): ReleaseNode {
  return {
    name: tagName,
    tagName,
    createdAt: "2026-10-18T08:00:00Z",
    publishedAt: "2026-10-18T08:05:00Z",
    url: `${repoUrl()}/releases/tag/${tagName}`,
    author: user(VIEWER),
    ...over,
  };
}

/** An empty repository: stargazers listed (token has access), nothing else yet. */
export function makeRepoNode(over: Partial<RepoNode> = {}): RepoNode {
  return {
    nameWithOwner: REPO,
    isPrivate: false,
    stargazerCount: 0,
    forkCount: 0,
    pushedAt: "2026-10-21T18:00:00Z",
    stargazers: { edges: [] },
    forks: { nodes: [] },
    issues: { nodes: [] },
    pullRequests: { nodes: [] },
    releases: { nodes: [] },
    ...over,
  };
}
