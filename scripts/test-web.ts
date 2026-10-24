/** Production PWA smoke test: no GitHub credentials or network API calls required. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { computeExecutablePath, Browser } from "@puppeteer/browsers";
import { launch } from "puppeteer-core";
import { preview } from "vite";
import type { Settings, DeviceState } from "../src/lib/types";
import type { ViewPrefs } from "../src/lib/prefs";

const server = await preview({ mode: "web", preview: { host: "127.0.0.1", port: 4187, strictPort: true } });
const browser = await launch({
  executablePath: computeExecutablePath({ browser: Browser.CHROME, buildId: "156.0.8078.47", cacheDir: resolve(".cache/chrome") }),
  headless: true,
});
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const url = "http://127.0.0.1:4187/";
  const publicRequests: string[] = [];
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (!request.url().startsWith("https://api.github.com")) {
      void request.continue();
      return;
    }
    publicRequests.push(request.url());
    assert.equal(request.headers().authorization, undefined);
    let data: unknown = [];
    if (request.url().endsWith("/users/tester")) data = { login: "tester", type: "User", avatar_url: "", public_repos: 1 };
    else if (request.url().includes("/users/tester/repos")) data = [{ full_name: "tester/project" }];
    else if (request.url().includes("/events"))
      data = [
        {
          id: "star-1",
          type: "WatchEvent",
          created_at: new Date().toISOString(),
          actor: { login: "a-fan", avatar_url: "" },
          payload: { action: "started" },
        },
      ];
    void request.respond({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(data),
    });
  });
  await page.goto(url);
  await page.waitForSelector("#setup-username");
  await mkdir(".cache/setup-preview", { recursive: true });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.screenshot({ path: ".cache/setup-preview/desktop.png" });
  await page.setViewport({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: ".cache/setup-preview/mobile.png", fullPage: true });
  await page.click('button[type="submit"]');
  await page.waitForSelector("#setup-error");
  await page.type("#setup-username", "tester");
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[name="access"]');
  assert.equal(await page.$("#setup-token"), null);
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[name="accent"]');
  await page.click('label.swatch:has(input[value="#a142f4"])');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: ".cache/setup-preview/color-mobile.png", fullPage: true });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.screenshot({ path: ".cache/setup-preview/color-desktop.png" });
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[name="style"]');
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[name="refresh"]');
  await page.click('input[name="refresh"][value="0"]');
  await page.click('button[type="submit"]');
  await page.waitForSelector("#q");
  await page.waitForFunction(() => document.body.textContent?.includes("a-fan"));
  const saved = await page.evaluate(async () => ({
    ...(await chrome.storage.sync.get<{ settings: Settings; view: ViewPrefs }>(["settings", "view"])),
    ...(await chrome.storage.local.get<{ device: DeviceState; token: string }>(["device", "token"])),
  }));
  assert.equal(saved.settings.username, "tester");
  assert.equal(saved.settings.accent, "#a142f4");
  assert.equal(saved.settings.includePrivate, false);
  assert.equal(saved.settings.refreshMinutes, 0);
  assert.equal(saved.settings.stack, true);
  assert.equal(saved.settings.trends, false);
  assert.equal(saved.view.hideMe, true);
  assert.equal(saved.view.hideBots, true);
  assert.equal(saved.device.onboardingComplete, true);
  assert.equal(saved.token, "");
  assert.ok(publicRequests.some((request) => request.includes("/repos/tester/project/events")));
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForSelector("#q");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    return (await fetch(link.href)).json();
  });
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon: { sizes: string }) => icon.sizes === "512x512"));
  await page.evaluate(async () => {
    await chrome.storage.sync.set({ webSmoke: "persisted" });
  });
  const second = await browser.newPage();
  await second.goto(url);
  await second.waitForSelector("#q");
  await second.evaluate(() => {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.webSmoke?.newValue === "broadcast") document.documentElement.dataset.broadcast = "ok";
    });
  });
  await page.evaluate(async () => {
    await chrome.storage.sync.set({ webSmoke: "broadcast" });
  });
  await second.waitForFunction(() => document.documentElement.dataset.broadcast === "ok");
  await second.close();
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("#q");
  assert.equal(await page.evaluate(async () => (await chrome.storage.sync.get("webSmoke")).webSmoke), "broadcast");
  assert.ok((await page.evaluate(() => document.body.textContent)).includes("Offline — showing saved activity."));
  assert.deepEqual(errors, []);
  assert.equal(await page.$("#setup-username"), null);
  const authContext = await browser.createBrowserContext();
  const auth = await authContext.newPage();
  await auth.setRequestInterception(true);
  auth.on("request", (request) => {
    if (!request.url().startsWith("https://api.github.com")) {
      void request.continue();
      return;
    }
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,user-agent",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    };
    if (request.method() === "OPTIONS") {
      void request.respond({ status: 204, headers });
      return;
    }
    if (request.headers().authorization === "Bearer invalid-test-token") {
      void request.respond({ status: 401, headers, body: "{}" });
      return;
    }
    const query = request.postData() ?? "";
    let data: unknown = { login: "tester", type: "User", avatar_url: "", public_repos: 0 };
    if (query.includes("following"))
      data = { viewer: { login: "tester", avatarUrl: "", organizations: { nodes: [] }, following: { nodes: [] } } };
    else if (query.includes("stargazers")) data = { viewer: {} };
    else if (query.includes("$owner"))
      data = {
        user: {
          login: "tester",
          avatarUrl: "",
          repositories: { totalCount: 0, nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      };
    void request.respond({ status: 200, contentType: "application/json", headers, body: JSON.stringify(query ? { data } : data) });
  });
  await auth.goto(url);
  await auth.waitForSelector("#setup-username");
  await auth.type("#setup-username", "tester");
  await auth.click('button[type="submit"]');
  await auth.waitForSelector('input[value="authenticated"]');
  await auth.click('input[value="authenticated"]');
  await auth.click('button[type="submit"]');
  await auth.waitForSelector("#setup-error");
  await auth.type("#setup-token", "invalid-test-token");
  await auth.click('button[type="submit"]');
  await auth.waitForFunction(() => document.getElementById("setup-error")?.textContent?.includes("401"));
  await auth.$eval("#setup-token", (input) => {
    (input as HTMLInputElement).value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await auth.type("#setup-token", "valid-test-token");
  await auth.click('button[type="submit"]');
  await auth.waitForSelector('input[name="accent"]');
  assert.equal(await auth.evaluate(async () => (await chrome.storage.local.get("token")).token), undefined);
  await auth.click('button[type="submit"]');
  await auth.waitForSelector('input[name="style"]');
  await auth.click('input[value="everything"]');
  await auth.click('button[type="submit"]');
  await auth.waitForSelector('input[name="refresh"]');
  await auth.click('input[name="refresh"][value="0"]');
  await auth.click('button[type="submit"]');
  await auth.waitForSelector("#q");
  const authenticated = await auth.evaluate(async () => ({
    ...(await chrome.storage.local.get<{ token: string; device: DeviceState }>(["token", "device"])),
    ...(await chrome.storage.sync.get<{ settings: Settings }>("settings")),
  }));
  assert.equal(authenticated.token, "valid-test-token");
  assert.equal(authenticated.device.onboardingComplete, true);
  assert.equal(authenticated.settings.includePrivate, true);
  assert.equal(authenticated.settings.trends, true);
  assert.equal(authenticated.settings.stack, false);
  await authContext.close();
  console.log(
    "Onboarding + PWA smoke passed: public and authenticated setup, validation errors, saved presets, one-time setup; manifest, startup, cross-tab storage, persistence and offline reload.",
  );
} finally {
  await browser.close();
  await new Promise<void>((resolveClose, reject) => server.httpServer.close((error) => (error ? reject(error) : resolveClose())));
}
