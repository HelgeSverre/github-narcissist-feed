import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock, uninstallChromeMock, type ChromeMock } from "../../tests/helpers/chrome-mock";
import { makeRepoNode } from "../../tests/helpers/factories";
import { KEYS } from "../lib/storage";
import type { Settings, Status } from "../lib/types";
import { GitHubError, type GqlResult } from "../lib/github";

const defaultSettings: Settings = {
  username: "HelgeSverre",
  owners: [{ login: "HelgeSverre", type: "user", on: true }],
  includePrivate: true,
  refreshMinutes: 10,
  showUnstars: false,
  trends: true,
  stack: true,
  stackScope: "org",
  stackRepoWindow: 60,
  stackOrgWindow: 180,
  dateFormat: "system",
  timeFormat: "24",
  weekStart: 1,
  theme: "system",
  density: "default",
};

const gqlMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/github")>();
  return { ...actual, gql: gqlMock };
});

vi.mock("./account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./account")>();
  return {
    ...actual,
    validateToken: vi.fn(async () => ({ viewer: "HelgeSverre", tokenOk: true, starsAccess: true }) satisfies Status),
  };
});

describe("refresh", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T10:00:00.000Z"));
    gqlMock.mockReset();
    mock = installChromeMock();
    mock.local.seed({ [KEYS.token]: "ghp_token", [KEYS.status]: { viewer: "HelgeSverre", tokenOk: true, starsAccess: true } });
    mock.sync.seed({ [KEYS.settings]: defaultSettings });
    (
      globalThis as unknown as {
        chrome: ChromeMock["chrome"] & { runtime: ChromeMock["chrome"]["runtime"] & { getPlatformInfo: () => void } };
      }
    ).chrome.runtime.getPlatformInfo = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    uninstallChromeMock();
  });

  it("clears the refreshing flag after a successful sweep", async () => {
    gqlMock
      .mockResolvedValueOnce({
        data: {
          user: {
            login: "HelgeSverre",
            avatarUrl: "https://avatars.githubusercontent.com/HelgeSverre?v=4",
            repositories: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "repo-1" }] },
          },
          organization: null,
        },
        rateLimit: { cost: 1, remaining: 4999, limit: 5000, resetAt: "2026-10-22T11:00:00Z" },
      } satisfies GqlResult<unknown>)
      .mockResolvedValueOnce({
        data: { nodes: [makeRepoNode({ stargazerCount: 1 })] },
        rateLimit: { cost: 1, remaining: 4998, limit: 5000, resetAt: "2026-10-22T11:00:00Z" },
      } satisfies GqlResult<unknown>);

    const { refresh } = await import("./refresh");
    await refresh("full", "test");

    expect((await mock.local.get(KEYS.status))[KEYS.status]).toMatchObject({ refreshing: null });
    expect(((await mock.local.get(KEYS.status))[KEYS.status] as Status).refreshingSince).toBeUndefined();
  });

  it("marks the token invalid when GitHub rejects a detail batch as forbidden auth", async () => {
    gqlMock
      .mockResolvedValueOnce({
        data: {
          user: {
            login: "HelgeSverre",
            avatarUrl: "https://avatars.githubusercontent.com/HelgeSverre?v=4",
            repositories: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: "repo-1" }] },
          },
          organization: null,
        },
        rateLimit: { cost: 1, remaining: 4999, limit: 5000, resetAt: "2026-10-22T11:00:00Z" },
      } satisfies GqlResult<unknown>)
      .mockRejectedValueOnce(new GitHubError("Resource not accessible by personal access token", undefined, "auth"));

    const { refresh } = await import("./refresh");
    await refresh("full", "test");

    expect((await mock.local.get(KEYS.status))[KEYS.status]).toMatchObject({ tokenOk: false });
  });
});
