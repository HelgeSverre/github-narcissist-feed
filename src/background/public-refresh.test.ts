import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "../../tests/helpers/chrome-mock";
import { DEFAULT_SETTINGS, type FeedEvent, type Status } from "../lib/types";
import { normalizePublicEvent, publicOwner, type PublicEvent } from "../lib/public-github";
import { refreshPublic } from "./public-refresh";

const event = (type = "WatchEvent"): PublicEvent => ({
  id: "1",
  type,
  created_at: new Date().toISOString(),
  actor: { login: "fan", avatar_url: "https://github.com/fan.png" },
  payload: { action: "started" },
});
function response(data: unknown, remaining = 59) {
  return new Response(JSON.stringify(data), {
    headers: {
      "x-ratelimit-remaining": String(remaining),
      "x-ratelimit-limit": "60",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    },
  });
}
beforeEach(() => {
  installChromeMock();
});
describe("public repository feed", () => {
  it("loads incoming stars without credentials and removes private cached rows", async () => {
    await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, username: "me", owners: [{ login: "me", type: "user", on: true }] } });
    await chrome.storage.local.set({ events: { private: { private: true, repo: "me/secret" } } });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([{ full_name: "me/project" }]))
      .mockResolvedValueOnce(response([event()]));
    vi.stubGlobal("fetch", fetcher);
    await refreshPublic("full");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toContain("/users/me/repos");
    expect(fetcher.mock.calls[1][0]).toContain("/repos/me/project/events");
    for (const [, options] of fetcher.mock.calls) {
      expect(options.credentials).toBe("omit");
      expect(options.headers).not.toHaveProperty("Authorization");
    }
    const { events, status } = await chrome.storage.local.get<{ events: Record<string, FeedEvent>; status: Status }>(["events", "status"]);
    expect(Object.values(events)).toEqual([expect.objectContaining({ actor: "fan", kind: "star", repo: "me/project", private: false })]);
    expect(status.refreshing).toBeNull();
    expect(status.publicCoverage).toEqual({ checked: 1, total: 1 });
  });
  it("rotates bounded batches to include dormant repositories", async () => {
    await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, username: "me", owners: [{ login: "me", type: "user", on: true }] } });
    const repos = Array.from({ length: 24 }, (_, i) => ({ full_name: `me/repo-${i}` }));
    const fetcher = vi.fn((url: string) => Promise.resolve(response(url.includes("/events") ? [] : repos)));
    vi.stubGlobal("fetch", fetcher);
    await refreshPublic("quick");
    expect(fetcher).toHaveBeenCalledTimes(20);
    expect((await chrome.storage.local.get("publicCursor")).publicCursor).toBe(19);
    fetcher.mockClear();
    await refreshPublic("quick");
    expect(fetcher.mock.calls[1][0]).toContain("/repos/me/repo-19/events");
    expect(fetcher.mock.calls.some(([url]) => url.includes("/repos/me/repo-23/events"))).toBe(true);
  });
  it("stops requests when anonymous quota is exhausted", async () => {
    await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, username: "me" } });
    await chrome.storage.local.set({
      status: { rateLimit: 60, rateRemaining: 0, rateResetAt: new Date(Date.now() + 60_000).toISOString() },
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await refreshPublic("full");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await chrome.storage.local.get<{ status: Status }>("status")).status.lastError).toContain("limit reached");
  });
  it("resolves organizations without a token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ login: "team", type: "Organization", avatar_url: "", public_repos: 3 })));
    expect(await publicOwner("team")).toEqual({ login: "team", type: "org", avatar: "", privateAccess: false, repoCount: 3 });
  });
  it("keeps saved activity and reports network errors", async () => {
    await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, username: "me", owners: [{ login: "me", type: "user", on: true }] } });
    const saved = normalizePublicEvent(event(), "me/project")!;
    await chrome.storage.local.set({ events: { [saved.id]: saved } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network unavailable")));
    await refreshPublic("full");
    const { events, status } = await chrome.storage.local.get<{ events: Record<string, FeedEvent>; status: Status }>(["events", "status"]);
    expect(events[saved.id]).toEqual(saved);
    expect(status.lastError).toBe("Network unavailable");
    expect(status.refreshing).toBeNull();
  });
});
describe("public event normalization", () => {
  it("ignores outgoing pushes and unknown event types", () => {
    expect(normalizePublicEvent(event("PushEvent"), "me/project")).toBeNull();
  });
  it("keeps merged pull requests and review context", () => {
    const raw = event("PullRequestEvent");
    raw.payload = {
      pull_request: { number: 42, title: "A fix", html_url: "https://github.com/me/project/pull/42", merged_at: new Date().toISOString() },
    };
    expect(normalizePublicEvent(raw, "me/project")).toMatchObject({ kind: "pr", number: 42, state: "MERGED", title: "A fix" });
  });
});
