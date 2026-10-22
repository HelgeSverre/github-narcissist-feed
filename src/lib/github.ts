import type { FeedEvent, OwnerMeta, Person, RepoLedger } from "./types";

const ENDPOINT = "https://api.github.com/graphql";
export const PAGE_SIZE = 20;

export class GitHubError extends Error {
  constructor(
    message: string,
    public status?: number,
    public kind: "auth" | "rate" | "server" | "network" | "graphql" = "server",
  ) {
    super(message);
  }
}

export interface GqlResult<T> {
  data: T;
  rateLimit?: { cost: number; remaining: number; limit: number; resetAt: string };
  tokenExpiresAt?: string | null;
  /** Partial errors: GitHub returns data with null nodes plus these when the token lacks a permission. */
  errors?: { message: string; type?: string; path?: (string | number)[] }[];
}

export async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}, attempt = 0): Promise<GqlResult<T>> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "github-narcissist-feed" },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new GitHubError(`Network error: ${(e as Error).message}`, undefined, "network");
  }
  if (res.status === 401) throw new GitHubError("Token rejected by GitHub (401). Check that it is valid and not expired.", 401, "auth");
  if ((res.status === 403 || res.status === 429) && attempt < 2) {
    // Secondary rate limit (too many concurrent requests): GitHub says how long to wait.
    const wait = Number(res.headers.get("retry-after"));
    if (wait > 0 && wait <= 60) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      return gql<T>(token, query, variables, attempt + 1);
    }
  }
  if (res.status === 403 || res.status === 429)
    throw new GitHubError("Rate limited by GitHub. Try again after the limit resets.", res.status, "rate");
  if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    return gql<T>(token, query, variables, attempt + 1);
  }
  if (!res.ok) throw new GitHubError(`GitHub returned HTTP ${res.status}`, res.status, "server");
  const body = (await res.json()) as {
    data?: T & { rateLimit?: GqlResult<T>["rateLimit"] };
    errors?: { message: string; type?: string; path?: (string | number)[] }[];
  };
  if (body.errors?.length && !body.data) {
    const e = body.errors[0];
    throw new GitHubError(e.message, undefined, e.type === "FORBIDDEN" ? "auth" : "graphql");
  }
  const exp = res.headers.get("github-authentication-token-expiration");
  return {
    data: body.data as T,
    rateLimit: body.data?.rateLimit,
    tokenExpiresAt: exp ? new Date(exp).toISOString() : null,
    errors: body.errors,
  };
}

// ---------- queries ----------

const ACTOR = `fragment A on Actor { __typename login avatarUrl }`;
const REPO = `fragment R on Repository {
  nameWithOwner isPrivate stargazerCount forkCount pushedAt
  stargazers(last:5, orderBy:{field:STARRED_AT, direction:ASC}) @include(if:$stars) { edges { starredAt node { login avatarUrl } } }
  forks(last:5, orderBy:{field:CREATED_AT, direction:ASC}) { nodes { createdAt nameWithOwner owner { login avatarUrl } } }
  issues(last:5, orderBy:{field:UPDATED_AT, direction:ASC}) { nodes { number title state createdAt updatedAt closedAt url author { ...A } comments(last:2) { totalCount nodes { createdAt url author { ...A } } } } }
  pullRequests(last:5, orderBy:{field:UPDATED_AT, direction:ASC}) { nodes { number title state isDraft createdAt updatedAt mergedAt closedAt url author { ...A } additions deletions comments(last:2) { totalCount nodes { createdAt url author { ...A } } } reviews(last:2) { nodes { state submittedAt url author { ...A } } } } }
  releases(last:3, orderBy:{field:CREATED_AT, direction:ASC}) { nodes { name tagName createdAt publishedAt url author { login avatarUrl } } }
}`;

/** Phase 1: list repository IDs for one owner, 100 per page (cost 1). */
export const LIST_QUERY = `query($owner:String!, $isOrg:Boolean!, $after:String, $n:Int!, $privacy:RepositoryPrivacy) {
  rateLimit { cost remaining limit resetAt }
  user(login:$owner) @skip(if:$isOrg) { login avatarUrl repositories(first:$n, after:$after, ownerAffiliations:OWNER, privacy:$privacy, orderBy:{field:PUSHED_AT, direction:DESC}) { totalCount pageInfo{hasNextPage endCursor} nodes { id } } }
  organization(login:$owner) @include(if:$isOrg) { login avatarUrl viewerIsAMember repositories(first:$n, after:$after, privacy:$privacy, orderBy:{field:PUSHED_AT, direction:DESC}) { totalCount pageInfo{hasNextPage endCursor} nodes { id } } }
}`;

/** Phase 2: full details for up to 20 repositories by ID. Independent, so batches run in parallel. */
export const DETAILS_QUERY = `query($ids:[ID!]!, $stars:Boolean!) {
  rateLimit { cost remaining limit resetAt }
  nodes(ids:$ids) { ... on Repository { ...R } }
}
${ACTOR}
${REPO}`;

export const VIEWER_QUERY = `{
  rateLimit { cost remaining limit resetAt }
  viewer { login avatarUrl
    organizations(first:100) { nodes { login avatarUrl viewerIsAMember } }
    following(first:100) { totalCount nodes { login avatarUrl } }
  }
}`;

export const OWNER_QUERY = `query($login:String!) {
  rateLimit { cost remaining limit resetAt }
  repositoryOwner(login:$login) { __typename login avatarUrl
    ... on User { repositories(ownerAffiliations:OWNER) { totalCount } }
    ... on Organization { viewerIsAMember repositories { totalCount } }
  }
}`;

export const SEARCH_QUERY = `query($q:String!) {
  rateLimit { cost remaining limit resetAt }
  search(type:USER, query:$q, first:8) { nodes { __typename ... on User { login avatarUrl } ... on Organization { login avatarUrl viewerIsAMember } } }
}`;

/** Fine-grained tokens need Contents: write to list stargazers (GitHub reports `contents=write`). */
export const STARS_PROBE_QUERY = `{ viewer { repositories(first:1, ownerAffiliations:OWNER) { nodes { stargazers(first:1) { totalCount } } } } }`;

export const STARGAZERS_QUERY = `query($owner:String!, $name:String!, $n:Int!, $stars:Boolean!) {
  rateLimit { cost remaining limit resetAt }
  repository(owner:$owner, name:$name) { stargazerCount
    stargazers(last:$n, orderBy:{field:STARRED_AT, direction:ASC}) @include(if:$stars) { edges { starredAt node { login avatarUrl } } }
    forks(last:$n, orderBy:{field:CREATED_AT, direction:ASC}) { nodes { createdAt nameWithOwner owner { login avatarUrl } } }
  }
}`;

// ---------- normalisation ----------

interface Actor {
  __typename?: string;
  login: string;
  avatarUrl: string;
}
export interface RepoNode {
  nameWithOwner: string;
  isPrivate: boolean;
  stargazerCount: number;
  forkCount: number;
  pushedAt: string;
  /** Absent when the token cannot list stargazers. */
  stargazers?: { edges: ({ starredAt: string; node: Actor | null } | null)[] };
  forks: { nodes: ({ createdAt: string; nameWithOwner: string; owner: Actor | null } | null)[] };
  issues: {
    nodes: ({
      number: number;
      title: string;
      state: string;
      createdAt: string;
      updatedAt: string;
      closedAt: string | null;
      url: string;
      author: Actor | null;
      comments: { totalCount: number; nodes: ({ createdAt: string; url: string; author: Actor | null } | null)[] };
    } | null)[];
  };
  pullRequests: {
    nodes: ({
      number: number;
      title: string;
      state: string;
      isDraft: boolean;
      createdAt: string;
      updatedAt: string;
      mergedAt: string | null;
      closedAt: string | null;
      url: string;
      author: Actor | null;
      additions: number;
      deletions: number;
      comments: { totalCount: number; nodes: ({ createdAt: string; url: string; author: Actor | null } | null)[] };
      reviews: { nodes: ({ state: string; submittedAt: string | null; url: string; author: Actor | null } | null)[] };
    } | null)[];
  };
  releases: {
    nodes: ({
      name: string | null;
      tagName: string;
      createdAt: string;
      publishedAt: string | null;
      url: string;
      author: Actor | null;
    } | null)[];
  };
}

const ghost: Actor = { login: "ghost", avatarUrl: "" };
const isBot = (a: Actor | null | undefined) => a?.__typename === "Bot";
const who = (a: Actor | null | undefined) => a ?? ghost;
/** GraphQL lists contain null for nodes the token cannot see (private forks, blocked users). */
const present = <T>(xs: (T | null | undefined)[] | null | undefined): T[] => (xs ?? []).filter((x): x is T => x != null);

export function normalizeRepo(r: RepoNode, viewer: string): FeedEvent[] {
  const out: FeedEvent[] = [];
  const repo = r.nameWithOwner;
  const base = { repo, private: r.isPrivate };
  for (const e of present(r.stargazers?.edges)) {
    if (!e.node) continue;
    out.push({
      id: `star:${repo}:${e.node.login}`,
      kind: "star",
      at: e.starredAt,
      actor: e.node.login,
      avatar: e.node.avatarUrl,
      bot: false,
      url: `https://github.com/${repo}`,
      stars: r.stargazerCount,
      ...base,
    });
  }
  for (const f of present(r.forks.nodes)) {
    const o = f.owner ?? { login: f.nameWithOwner.split("/")[0], avatarUrl: "" };
    out.push({
      id: `fork:${f.nameWithOwner}`,
      kind: "fork",
      at: f.createdAt,
      actor: o.login,
      avatar: o.avatarUrl,
      bot: false,
      url: `https://github.com/${f.nameWithOwner}`,
      title: f.nameWithOwner,
      forks: r.forkCount,
      ...base,
    });
  }
  for (const i of present(r.issues.nodes)) {
    const a = who(i.author);
    out.push({
      id: `issue:${i.url}`,
      kind: "issue",
      at: i.updatedAt,
      created: i.createdAt,
      closed: i.closedAt,
      actor: a.login,
      avatar: a.avatarUrl,
      bot: isBot(i.author),
      url: i.url,
      title: i.title,
      number: i.number,
      state: i.state,
      comments: i.comments.totalCount,
      ...base,
    });
    for (const c of present(i.comments?.nodes)) {
      const ca = who(c.author);
      out.push({
        id: `comment:${c.url}`,
        kind: "comment",
        at: c.createdAt,
        actor: ca.login,
        avatar: ca.avatarUrl,
        bot: isBot(c.author),
        url: c.url,
        title: i.title,
        number: i.number,
        state: "ISSUE",
        ...base,
      });
    }
  }
  for (const p of present(r.pullRequests.nodes)) {
    const a = who(p.author);
    const state = p.isDraft && p.state === "OPEN" ? "DRAFT" : p.state;
    out.push({
      id: `pr:${p.url}`,
      kind: "pr",
      at: p.updatedAt,
      created: p.createdAt,
      closed: p.closedAt,
      merged: p.mergedAt,
      actor: a.login,
      avatar: a.avatarUrl,
      bot: isBot(p.author),
      url: p.url,
      title: p.title,
      number: p.number,
      state,
      comments: p.comments.totalCount,
      ...base,
    });
    for (const c of present(p.comments?.nodes)) {
      const ca = who(c.author);
      out.push({
        id: `comment:${c.url}`,
        kind: "comment",
        at: c.createdAt,
        actor: ca.login,
        avatar: ca.avatarUrl,
        bot: isBot(c.author),
        url: c.url,
        title: p.title,
        number: p.number,
        state: "PR",
        ...base,
      });
    }
    for (const rv of present(p.reviews?.nodes)) {
      if (!rv.submittedAt) continue;
      const ra = who(rv.author);
      if (ra.login === a.login && rv.state === "COMMENTED") continue; // self review-comments are noise
      out.push({
        id: `review:${rv.url}`,
        kind: "review",
        at: rv.submittedAt,
        actor: ra.login,
        avatar: ra.avatarUrl,
        bot: isBot(rv.author),
        url: rv.url,
        title: p.title,
        number: p.number,
        state: rv.state,
        ...base,
      });
    }
  }
  for (const rel of present(r.releases?.nodes)) {
    const ra = rel.author ?? { login: viewer, avatarUrl: "" };
    out.push({
      id: `release:${rel.url}`,
      kind: "release",
      at: rel.publishedAt ?? rel.createdAt,
      actor: ra.login,
      avatar: ra.avatarUrl,
      bot: false,
      url: rel.url,
      title: rel.name || rel.tagName,
      tag: rel.tagName,
      ...base,
    });
  }
  return out;
}

export function ledgerOf(r: RepoNode, prev?: RepoLedger): RepoLedger {
  const stargazers = r.stargazers ? present(r.stargazers.edges).flatMap((e) => (e.node ? [e.node.login] : [])) : (prev?.stargazers ?? []);
  return {
    private: r.isPrivate,
    stars: r.stargazerCount,
    forks: r.forkCount,
    stargazers,
    forkNames: present(r.forks.nodes).map((f) => f.nameWithOwner),
    pushedAt: r.pushedAt,
  };
}

export function ownerMetaFrom(
  login: string,
  node: { __typename?: string; avatarUrl: string; viewerIsAMember?: boolean; repositories?: { totalCount: number } } | null,
  viewer: string,
): OwnerMeta | null {
  if (!node) return null;
  const type = node.__typename === "Organization" ? "org" : "user";
  return {
    login,
    type,
    avatar: node.avatarUrl,
    privateAccess: type === "org" ? !!node.viewerIsAMember : login.toLowerCase() === viewer.toLowerCase(),
    repoCount: node.repositories?.totalCount,
  };
}

export function peopleFrom(viewer: {
  organizations: { nodes: { login: string; avatarUrl: string; viewerIsAMember: boolean }[] };
  following: { nodes: { login: string; avatarUrl: string }[] };
}): Person[] {
  return [
    ...viewer.organizations.nodes.map((o) => ({
      login: o.login,
      avatar: o.avatarUrl,
      type: "org" as const,
      group: "Your organizations" as const,
      privateAccess: o.viewerIsAMember,
    })),
    ...viewer.following.nodes.map((u) => ({
      login: u.login,
      avatar: u.avatarUrl,
      type: "user" as const,
      group: "People you follow" as const,
      privateAccess: false,
    })),
  ];
}
