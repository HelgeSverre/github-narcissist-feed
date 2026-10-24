/** Bounded repository polling for the anonymous REST budget (60 requests/hour/IP). */
import { publicGet, normalizePublicEvent, type PublicEvent } from "../lib/public-github";
import { getSettings, getEvents, getLocal, getStatus, patchStatus, setLocal } from "../lib/storage";
import { mergeEvent, prune } from "./ledger";

interface Repo {
  full_name: string;
}
export async function refreshPublic(mode: "quick" | "full") {
  const settings = await getSettings();
  if (!settings.username) return patchStatus({ refreshing: null, tokenError: undefined });
  const status = await getStatus();
  if (status.rateLimit === 60 && (status.rateRemaining ?? 60) < 3 && Date.parse(status.rateResetAt ?? "") > Date.now())
    return patchStatus({
      refreshing: null,
      lastError: "Public request limit reached. Wait until it resets or connect a token in Settings.",
    });
  const now = new Date().toISOString();
  await patchStatus({ refreshing: mode, refreshingSince: now, tokenError: undefined, lastError: null });
  let budget = 20;
  const events = await getEvents();
  const repos: string[] = [];
  const ownerNames = new Set(settings.owners.map((owner) => owner.login.toLowerCase()));
  // Public mode must never keep previously cached private rows visible.
  for (const [id, event] of Object.entries(events))
    if (event.private || !ownerNames.has(event.repo.split("/")[0].toLowerCase())) delete events[id];
  const request = async <T>(path: string) => {
    const current = await getStatus();
    if (
      --budget < 0 ||
      (current.rateLimit === 60 && (current.rateRemaining ?? 60) < 3 && Date.parse(current.rateResetAt ?? "") > Date.now())
    )
      throw new Error("Public request budget reached. More repositories will be checked on the next refresh.");
    return publicGet<T>(path);
  };
  let checked = 0;
  try {
    for (const owner of settings.owners) {
      for (let page = 1; ; page++) {
        const prefix = owner.type === "org" ? "orgs" : "users";
        const { data, next } = await request<Repo[]>(
          `/${prefix}/${encodeURIComponent(owner.login)}/repos?type=${owner.type === "org" ? "public" : "owner"}&per_page=100&page=${page}&sort=pushed&direction=desc`,
        );
        repos.push(...data.map((repo) => repo.full_name));
        if (!next) break;
      }
    }
    // Resume after the previous batch, covering dormant repositories as well as recently pushed ones.
    const cursor = await getLocal<number>("publicCursor", 0);
    const count = Math.min(repos.length, budget);
    for (let i = 0; i < count; i++) {
      const repo = repos[(cursor + i) % repos.length];
      const { data } = await request<PublicEvent[]>(`/repos/${repo.split("/").map(encodeURIComponent).join("/")}/events?per_page=100`);
      for (const raw of data) {
        const event = normalizePublicEvent(raw, repo);
        if (event) mergeEvent(events, event);
      }
      checked++;
      await setLocal({ publicCursor: (cursor + checked) % repos.length });
    }
    await patchStatus({
      lastQuickAt: now,
      ...(mode === "full" ? { lastFullAt: now } : {}),
      publicCoverage: { checked, total: repos.length },
    });
  } catch (error) {
    await patchStatus({ lastError: (error as Error).message });
  } finally {
    prune(events);
    await setLocal({ events });
    await patchStatus({ refreshing: null, refreshingSince: undefined });
  }
  return getStatus();
}
