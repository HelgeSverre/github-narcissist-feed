/**
 * Pure event and ledger logic for the refresh sweep. No chrome APIs and no I/O: everything comes in as an argument,
 * and the only side effects are mutations of the objects the caller passes in (`events`, `followUps`).
 */
import type { RepoNode } from "../lib/github";
import type { FeedEvent, RepoLedger } from "../lib/types";

export const MAX_EVENTS = 6000;
export const EVENT_TTL_DAYS = 400;

export function mergeEvent(events: Record<string, FeedEvent>, e: FeedEvent) {
  const cur = events[e.id];
  if (!cur || cur.at <= e.at) events[e.id] = e;
}

export function diffLedger(
  repo: RepoNode,
  prev: RepoLedger,
  events: Record<string, FeedEvent>,
  followUps: { repo: string; n: number }[],
  now: string,
) {
  const name = repo.nameWithOwner;
  const curStars = new Set((repo.stargazers?.edges ?? []).flatMap((e) => (e?.node ? [e.node.login] : [])));
  if (!repo.stargazers) {
    /* cannot see stargazers: no unstar detection or star follow-ups */
  } else if (repo.stargazerCount < prev.stars) {
    for (const login of prev.stargazers)
      if (!curStars.has(login)) {
        events[`unstar:${name}:${login}:${now.slice(0, 13)}`] = {
          id: `unstar:${name}:${login}:${now.slice(0, 13)}`,
          kind: "unstar",
          at: now,
          repo: name,
          private: repo.isPrivate,
          actor: login,
          avatar: `https://github.com/${login}.png?size=40`,
          bot: false,
          url: `https://github.com/${login}`,
          stars: repo.stargazerCount,
        };
      }
  } else if (repo.stargazerCount - prev.stars > 5) {
    followUps.push({ repo: name, n: Math.min(100, repo.stargazerCount - prev.stars) });
  }
  const curForks = new Set(repo.forks.nodes.flatMap((f) => (f ? [f.nameWithOwner] : [])));
  if (repo.forkCount < prev.forks) {
    for (const fk of prev.forkNames)
      if (!curForks.has(fk)) {
        const login = fk.split("/")[0];
        events[`unfork:${fk}:${now.slice(0, 13)}`] = {
          id: `unfork:${fk}:${now.slice(0, 13)}`,
          kind: "unfork",
          at: now,
          repo: name,
          private: repo.isPrivate,
          actor: login,
          avatar: `https://github.com/${login}.png?size=40`,
          bot: false,
          url: `https://github.com/${login}`,
          title: fk,
          forks: repo.forkCount,
        };
      }
  } else if (repo.forkCount - prev.forks > 5) {
    followUps.push({ repo: name, n: Math.min(100, repo.forkCount - prev.forks) });
  }
}

export function prune(events: Record<string, FeedEvent>) {
  const cutoff = Date.now() - EVENT_TTL_DAYS * 864e5;
  const ids = Object.keys(events).sort((a, b) => (events[a].at < events[b].at ? 1 : -1));
  ids.forEach((id, i) => {
    if (i >= MAX_EVENTS || Date.parse(events[id].at) < cutoff) delete events[id];
  });
}
