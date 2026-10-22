/** The refresh sweep: one at a time per worker, listing then details then burst follow-ups, saved incrementally. */
import {
  DETAILS_QUERY,
  GitHubError,
  LIST_QUERY,
  type GqlResult,
  PAGE_SIZE,
  STARGAZERS_QUERY,
  gql,
  ledgerOf,
  normalizeRepo,
  type RepoNode,
} from "../lib/github";
import { KEYS, getEvents, getLedger, getOwners, getSettings, getStatus, getToken, patchStatus, setLocal } from "../lib/storage";
import { rate, validateToken } from "./account";
import { diffLedger, mergeEvent, prune } from "./ledger";
import { log } from "./log";

const QUICK_REPOS = 40; // most recently pushed repositories per owner in a quick refresh
const CONCURRENCY = 6; // parallel detail requests; measured: 520 repos in ~16 s, no throttling
export const REFRESH_LOCK_MS = 3 * 60_000;

// One sweep at a time per worker instance; the storage flag below covers a worker that was killed.
let running: Promise<unknown> | null = null;
/** Sweep requested while one runs. `only` = owners to sweep; undefined = every owner. */
let queued: { only?: string[] } | null = null;

export async function refresh(mode: "quick" | "full", reason = "unknown", only?: string[]): Promise<unknown> {
  if (running) {
    if (mode === "full") queued = (queued && !queued.only) || !only ? {} : { only: [...new Set([...(queued?.only ?? []), ...only])] };
    log("refresh", mode, "requested by", reason, "while running; queued:", JSON.stringify(queued));
    return running;
  }
  log("refresh", mode, "started by", reason, only ? `(only ${only.join(", ")})` : "");
  running = runRefresh(mode, only).finally(() => {
    running = null;
    const next = queued;
    queued = null;
    if (next) void refresh("full", "queued", next.only);
  });
  return running;
}

/** Run `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

interface ListData {
  user?: { login: string; avatarUrl: string; repositories: ListPage } | null;
  organization?: { login: string; avatarUrl: string; viewerIsAMember: boolean; repositories: ListPage } | null;
}
interface ListPage {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: ({ id: string } | null)[];
}

async function runRefresh(mode: "quick" | "full", only?: string[]) {
  const t0 = Date.now();
  const status = await getStatus();
  if (status.refreshing && status.refreshingSince && Date.now() - Date.parse(status.refreshingSince) < REFRESH_LOCK_MS) {
    log("refresh skipped: storage lock held since", status.refreshingSince);
    return status;
  }
  const token = await getToken();
  if (!token) return patchStatus({ tokenOk: false, tokenError: "No token configured", refreshing: null });
  const settings = await getSettings();
  let viewer = status.viewer;
  let stars = status.starsAccess;
  // Re-probe while stars are unavailable, so editing the token's permissions on GitHub takes effect without re-pasting it.
  if (!viewer || !status.tokenOk || stars !== true) {
    const s = await validateToken(token);
    if (!s.tokenOk) return s;
    viewer = s.viewer;
    stars = s.starsAccess;
  }
  const starsOk = stars !== false;
  const configured = settings.owners.length ? settings.owners : viewer ? [{ login: viewer, type: "user" as const, on: true }] : [];
  const onlySet = only && new Set(only.map((o) => o.toLowerCase()));
  const owners = onlySet ? configured.filter((o) => onlySet.has(o.login.toLowerCase())) : configured;
  const keep = new Set(configured.map((o) => o.login.toLowerCase()));
  await patchStatus({ refreshing: mode, refreshingSince: new Date().toISOString(), lastError: null });

  // Chrome stops an idle MV3 worker after ~30 s; plain fetch() does not count as activity.
  const keepAlive = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, 20_000);

  const events = await getEvents();
  const ledger = await getLedger();
  const meta = await getOwners();
  const followUps: { repo: string; n: number }[] = [];
  const now = new Date().toISOString();
  let lastRate: Partial<ReturnType<typeof rate>> = {};
  const errors: string[] = [];
  let stop = false; // set on auth / hard rate-limit errors
  const privacy = settings.includePrivate ? null : "PUBLIC";
  const save = async () => {
    // Drop data for owners that were removed from settings.
    for (const id of Object.keys(events)) if (!keep.has(events[id].repo.split("/")[0].toLowerCase())) delete events[id];
    for (const r of Object.keys(ledger)) if (!keep.has(r.split("/")[0].toLowerCase())) delete ledger[r];
    prune(events);
    await setLocal({ [KEYS.events]: events, [KEYS.ledger]: ledger, [KEYS.owners]: meta });
    await patchStatus({ ...lastRate, refreshingSince: new Date().toISOString() });
  };
  const fail = (where: string, e: unknown) => {
    errors.push(`${where}: ${(e as Error).message}`);
    if (e instanceof GitHubError && (e.kind === "auth" || e.kind === "rate")) stop = true;
  };

  try {
    // Phase 1: list repository IDs, all owners in parallel (cheap, 100 per page).
    const lists = await Promise.all(
      owners.map(async (owner) => {
        const ids: string[] = [];
        try {
          let isOrg = (meta[owner.login]?.type ?? owner.type) === "org";
          let after: string | null = null;
          let first = true;
          // oxlint-disable-next-line no-unmodified-loop-condition -- `stop` is set by fail() from concurrent owner sweeps
          while (!stop) {
            const n = mode === "quick" ? QUICK_REPOS : 100;
            let res: GqlResult<ListData> = await gql<ListData>(token, LIST_QUERY, { owner: owner.login, isOrg, after, n, privacy });
            let node = isOrg ? res.data.organization : res.data.user;
            if (!node && first) {
              // wrong user/org guess: try the other once
              isOrg = !isOrg;
              res = await gql<ListData>(token, LIST_QUERY, { owner: owner.login, isOrg, after, n, privacy });
              node = isOrg ? res.data.organization : res.data.user;
            }
            if (!node) throw new GitHubError(`No GitHub user or organization named ${owner.login}`, undefined, "graphql");
            lastRate = rate(res.rateLimit);
            first = false;
            meta[owner.login] = {
              login: node.login,
              type: isOrg ? "org" : "user",
              avatar: node.avatarUrl,
              privateAccess: isOrg
                ? !!(node as { viewerIsAMember?: boolean }).viewerIsAMember
                : node.login.toLowerCase() === (viewer ?? "").toLowerCase(),
              repoCount: node.repositories.totalCount,
            };
            for (const r of node.repositories.nodes) if (r) ids.push(r.id);
            if (mode === "quick" || !node.repositories.pageInfo.hasNextPage) break;
            after = node.repositories.pageInfo.endCursor;
          }
        } catch (e) {
          fail(owner.login, e);
        }
        return ids;
      }),
    );
    const ids = lists.flat();
    log("listed", ids.length, "repositories in", Date.now() - t0, "ms");

    // Phase 2: details, 20 repositories per request, CONCURRENCY requests in flight.
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += PAGE_SIZE) batches.push(ids.slice(i, i + PAGE_SIZE));
    let done = 0;
    await pool(batches, CONCURRENCY, async (batch) => {
      if (stop) return;
      try {
        const res = await gql<{ nodes: (RepoNode | null)[] }>(token, DETAILS_QUERY, { ids: batch, stars: starsOk });
        lastRate = rate(res.rateLimit);
        // Null nodes with errors mean the token lacks a permission. Report it instead of silently skipping.
        const missing = res.data.nodes.filter((n) => !n?.nameWithOwner).length;
        if (missing && res.errors?.length)
          errors.push(`${missing} repositories unreadable: ${[...new Set(res.errors.map((e) => e.message))].join("; ")}`);
        for (const repo of res.data.nodes) {
          if (!repo?.nameWithOwner) continue;
          try {
            const prev = ledger[repo.nameWithOwner];
            for (const e of normalizeRepo(repo, viewer ?? "")) mergeEvent(events, e);
            if (prev) diffLedger(repo, prev, events, followUps, now);
            ledger[repo.nameWithOwner] = ledgerOf(repo, prev);
          } catch (e) {
            errors.push(`${repo.nameWithOwner}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        fail(`batch of ${batch.length}`, e);
      }
      if (++done % CONCURRENCY === 0) await save(); // rows appear while the sweep runs
    });

    // Star/fork bursts: page deeper on the repositories that jumped.
    await pool(followUps.slice(0, 20), CONCURRENCY, async (f) => {
      if (stop) return;
      try {
        const [o, n] = f.repo.split("/");
        const res = await gql<{ repository: RepoNode | null }>(token, STARGAZERS_QUERY, { owner: o, name: n, n: f.n, stars: starsOk });
        lastRate = rate(res.rateLimit);
        const r = res.data.repository;
        if (!r) return;
        const priv = ledger[f.repo]?.private ?? false;
        for (const e of r.stargazers?.edges ?? [])
          if (e?.node)
            mergeEvent(events, {
              id: `star:${f.repo}:${e.node.login}`,
              kind: "star",
              at: e.starredAt,
              repo: f.repo,
              private: priv,
              actor: e.node.login,
              avatar: e.node.avatarUrl,
              bot: false,
              url: `https://github.com/${f.repo}`,
              stars: r.stargazerCount,
            });
        for (const fk of r.forks.nodes)
          if (fk)
            mergeEvent(events, {
              id: `fork:${fk.nameWithOwner}`,
              kind: "fork",
              at: fk.createdAt,
              repo: f.repo,
              private: priv,
              actor: fk.owner?.login ?? fk.nameWithOwner.split("/")[0],
              avatar: fk.owner?.avatarUrl ?? "",
              bot: false,
              url: `https://github.com/${fk.nameWithOwner}`,
              title: fk.nameWithOwner,
              forks: r.forkCount,
            });
      } catch (e) {
        fail(f.repo, e);
      }
    });

    await save();
    log(
      "refresh",
      mode,
      "done in",
      Date.now() - t0,
      "ms:",
      Object.keys(events).length,
      "events,",
      Object.keys(ledger).length,
      "repos,",
      errors.length,
      "errors",
    );
    const stamp = mode === "full" && !only ? { lastFullAt: now, lastQuickAt: now } : { lastQuickAt: now };
    const uniq = [...new Set(errors)];
    return await patchStatus({
      ...stamp,
      ...lastRate,
      lastError: uniq.length ? uniq.slice(0, 3).join(" · ") + (uniq.length > 3 ? ` · and ${uniq.length - 3} more` : "") : null,
      tokenOk: !errors.some((x) => /401|rejected/.test(x)),
    });
  } catch (e) {
    return await patchStatus({ lastError: (e as Error).message });
  } finally {
    clearInterval(keepAlive);
    await patchStatus({ refreshing: null, refreshingSince: undefined });
  }
}
