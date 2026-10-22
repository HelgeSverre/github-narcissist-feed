/** Token validation and the owner/people lookups the settings page asks for. Talks to GitHub and chrome.storage. */
import { OWNER_QUERY, SEARCH_QUERY, STARS_PROBE_QUERY, VIEWER_QUERY, gql, ownerMetaFrom, peopleFrom } from "../lib/github";
import { KEYS, getOwners, getSettings, getStatus, getToken, patchStatus, setLocal, setSettings } from "../lib/storage";
import type { OwnerMeta, Person } from "../lib/types";
import { log } from "./log";

interface ViewerData {
  viewer: {
    login: string;
    avatarUrl: string;
    organizations: { nodes: { login: string; avatarUrl: string; viewerIsAMember: boolean }[] };
    following: { nodes: { login: string; avatarUrl: string }[] };
  };
}

export async function validateToken(token?: string) {
  const t = token?.trim() || (await getToken());
  if (!t) return patchStatus({ tokenOk: false, tokenError: "No token configured", viewer: undefined });
  try {
    const res = await gql<ViewerData>(t, VIEWER_QUERY);
    const viewer = res.data.viewer.login;
    const settings = await getSettings();
    if (!settings.username || !settings.owners.some((o) => o.login.toLowerCase() === viewer.toLowerCase())) {
      const owners = settings.owners.filter((o) => o.login.toLowerCase() !== viewer.toLowerCase());
      await setSettings({ username: settings.username || viewer, owners: [{ login: viewer, type: "user", on: true }, ...owners] });
    }
    const people: Person[] = peopleFrom(res.data.viewer);
    const owners = await getOwners();
    owners[viewer] = { login: viewer, type: "user", avatar: res.data.viewer.avatarUrl, privateAccess: true };
    for (const o of res.data.viewer.organizations.nodes)
      owners[o.login] = { ...owners[o.login], login: o.login, type: "org", avatar: o.avatarUrl, privateAccess: o.viewerIsAMember };
    await setLocal({ [KEYS.people]: people, [KEYS.owners]: owners });
    // Probe the one permission fine-grained tokens commonly miss. Without it GitHub nulls the whole repository.
    const probe = await gql<unknown>(t, STARS_PROBE_QUERY);
    const starsAccess = !(probe.errors ?? []).some((e) => e.path?.includes("stargazers"));
    if (!starsAccess) log("token cannot list stargazers; stars are skipped");
    return patchStatus({
      viewer,
      tokenOk: true,
      tokenError: undefined,
      starsAccess,
      tokenExpiresAt: res.tokenExpiresAt ?? null,
      ...rate(res.rateLimit),
    });
  } catch (e) {
    return patchStatus({ tokenOk: false, tokenError: (e as Error).message });
  }
}

export async function loadPeople() {
  await validateToken();
  const r = await chrome.storage.local.get(KEYS.people);
  return (r[KEYS.people] as Person[]) ?? [];
}

export async function searchOwners(q: string) {
  const token = await getToken();
  if (!token || q.trim().length < 2) return [];
  const res = await gql<{ search: { nodes: { __typename: string; login?: string; avatarUrl?: string; viewerIsAMember?: boolean }[] } }>(
    token,
    SEARCH_QUERY,
    { q: q.trim() },
  );
  await patchStatus(rate(res.rateLimit));
  return res.data.search.nodes
    .filter((n) => n.login)
    .map((n) => ({
      login: n.login!,
      avatar: n.avatarUrl ?? "",
      type: n.__typename === "Organization" ? "org" : "user",
      privateAccess: !!n.viewerIsAMember,
    }));
}

export async function resolveOwner(login: string): Promise<OwnerMeta | { error: string }> {
  const token = await getToken();
  if (!token) return { error: "No token" };
  const status = await getStatus();
  const res = await gql<{
    repositoryOwner: {
      __typename: string;
      login: string;
      avatarUrl: string;
      viewerIsAMember?: boolean;
      repositories?: { totalCount: number };
    } | null;
  }>(token, OWNER_QUERY, { login });
  await patchStatus(rate(res.rateLimit));
  const meta = ownerMetaFrom(res.data.repositoryOwner?.login ?? login, res.data.repositoryOwner, status.viewer ?? "");
  if (!meta) return { error: `No GitHub user or organization named ${login}` };
  const owners = await getOwners();
  owners[meta.login] = meta;
  await setLocal({ [KEYS.owners]: owners });
  return meta;
}

export function rate(r?: { remaining: number; limit: number; resetAt: string }) {
  return r ? { rateRemaining: r.remaining, rateLimit: r.limit, rateResetAt: r.resetAt } : {};
}
