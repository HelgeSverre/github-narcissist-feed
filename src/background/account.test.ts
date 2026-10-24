import { beforeEach, expect, it, vi } from "vitest";
import { installChromeMock } from "../../tests/helpers/chrome-mock";
import { validateToken } from "./account";

beforeEach(() => {
  installChromeMock();
});
it("validates a draft token without saving settings, tokens or account state", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { viewer: { login: "viewer", avatarUrl: "", organizations: { nodes: [] }, following: { nodes: [] } } } }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { viewer: {} } }))),
  );
  expect(await validateToken("draft-token")).toMatchObject({ tokenOk: true, viewer: "viewer", starsAccess: true });
  expect(await chrome.storage.local.get(null)).toEqual({});
  expect(await chrome.storage.sync.get(null)).toEqual({});
});
it("returns a rejected draft token error without changing a previously connected account", async () => {
  await chrome.storage.local.set({ token: "existing-token", status: { tokenOk: true, viewer: "existing" } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })));
  expect(await validateToken("bad-draft")).toMatchObject({ tokenOk: false });
  expect(await chrome.storage.local.get(null)).toEqual({ token: "existing-token", status: { tokenOk: true, viewer: "existing" } });
});
