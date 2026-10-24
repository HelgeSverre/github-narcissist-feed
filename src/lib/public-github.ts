/** Token-free REST access. Never attaches credentials or uses the authenticated GraphQL client. */
import type { FeedEvent, OwnerMeta } from "./types";
import { patchStatus } from "./storage";

export async function publicGet<T>(path: string): Promise<{ data: T; next: boolean }> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
    signal: AbortSignal.timeout(30_000),
  });
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  if (remaining !== null)
    await patchStatus({
      rateRemaining: Number(remaining),
      rateLimit: Number(response.headers.get("x-ratelimit-limit") ?? 60),
      rateResetAt: reset ? new Date(Number(reset) * 1000).toISOString() : undefined,
    });
  if (!response.ok) {
    if (response.status === 404) throw new Error("That GitHub account or repository was not found. Check the username and try again.");
    if (response.status === 403 || response.status === 429)
      throw new Error("GitHub has paused public requests. Try again after the rate limit resets, or connect a token in Settings.");
    throw new Error(`GitHub could not load public data (${response.status}). Please try again.`);
  }
  return { data: (await response.json()) as T, next: /rel="next"/.test(response.headers.get("link") ?? "") };
}

export async function publicOwner(login: string): Promise<OwnerMeta> {
  const { data } = await publicGet<{ login: string; type: string; avatar_url: string; public_repos: number }>(
    `/users/${encodeURIComponent(login)}`,
  );
  return {
    login: data.login,
    type: data.type === "Organization" ? "org" : "user",
    avatar: data.avatar_url,
    privateAccess: false,
    repoCount: data.public_repos,
  };
}

interface Item {
  html_url?: string;
  title?: string;
  number?: number;
  state?: string;
  created_at?: string;
  closed_at?: string;
  merged_at?: string;
  draft?: boolean;
  body?: string;
  tag_name?: string;
  submitted_at?: string;
}
export interface PublicEvent {
  id: string;
  type: string;
  created_at: string;
  actor: { login: string; avatar_url: string; type?: string };
  payload: {
    action?: string;
    issue?: Item;
    pull_request?: Item;
    comment?: Item;
    review?: Item;
    release?: Item;
    forkee?: Item;
  };
}

export function normalizePublicEvent(event: PublicEvent, repo: string): FeedEvent | null {
  const p = event.payload;
  const base: FeedEvent = {
    id: `public:${event.id}`,
    kind: "star",
    at: event.created_at,
    repo,
    private: false,
    actor: event.actor.login,
    avatar: event.actor.avatar_url,
    bot: event.actor.type === "Bot" || event.actor.login.endsWith("[bot]"),
    url: `https://github.com/${repo}`,
  };
  let item: Item | undefined;
  switch (event.type) {
    case "WatchEvent":
      if (p.action !== "started") return null;
      base.kind = "star";
      base.url = `https://github.com/${event.actor.login}`;
      break;
    case "ForkEvent":
      base.kind = "fork";
      item = p.forkee;
      break;
    case "IssuesEvent":
      base.kind = "issue";
      item = p.issue;
      break;
    case "PullRequestEvent":
      base.kind = "pr";
      item = p.pull_request;
      break;
    case "IssueCommentEvent":
      base.kind = "comment";
      item = p.comment;
      base.title = p.issue?.title;
      base.number = p.issue?.number;
      base.state = "ISSUE";
      break;
    case "PullRequestReviewEvent":
      base.kind = "review";
      item = p.review;
      base.title = p.pull_request?.title;
      base.number = p.pull_request?.number;
      break;
    case "PullRequestReviewCommentEvent":
      base.kind = "comment";
      item = p.comment;
      base.title = p.pull_request?.title;
      base.number = p.pull_request?.number;
      base.state = "PR";
      break;
    case "ReleaseEvent":
      if (p.action !== "published") return null;
      base.kind = "release";
      item = p.release;
      break;
    default:
      return null;
  }
  if (item) {
    base.url = item.html_url ?? base.url;
    base.title ??= item.title ?? item.tag_name;
    base.number ??= item.number;
    base.state ??= item.merged_at ? "MERGED" : item.draft ? "DRAFT" : item.state?.toUpperCase();
    base.created = item.created_at;
    base.closed = item.closed_at;
    base.merged = item.merged_at;
    base.tag = item.tag_name;
  }
  return base;
}
