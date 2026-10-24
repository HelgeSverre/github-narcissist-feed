/**
 * Settings > Appearance: theme toggle and accent colour reach chrome.storage.sync and the page's CSS, and survive a reload.
 * Needs no GitHub token: setup is marked complete so this suite tests Settings directly.
 */
import type { Page } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { deriveAccent } from "../../src/lib/accent";
import { launchExtension, type ExtensionSession } from "./helpers/browser";

let ext: ExtensionSession;
let page: Page;
beforeAll(async () => {
  ext = await launchExtension();
  await ext.inWorker(() => chrome.storage.local.set({ device: { onboardingComplete: true } }));
  page = await ext.openPage({ ready: "#s-appearance" });
});
afterAll(async () => {
  await ext?.close();
});
afterEach(async ({ task }) => {
  await ext.afterTest(task);
});

const look = () =>
  page.$eval("html", (el) => ({
    theme: el.getAttribute("data-theme"),
    accent: getComputedStyle(el).getPropertyValue("--accent").trim(),
    checked: getComputedStyle(document.querySelector('.swatches [aria-checked="true"]')!).getPropertyValue("--sw").trim(),
  }));
const stored = async () => (await ext.syncStorage()).settings;
const waitForStored = async (want: { theme?: string; accent?: string }) => {
  await expect.poll(stored, { timeout: 5_000 }).toMatchObject(want);
};

describe("appearance", () => {
  const purple = deriveAccent("#a142f4");

  it("applies a preset accent and the theme toggle, and syncs both", async () => {
    await page.click('.swatches [aria-label="Purple"]');
    await page.click('[aria-labelledby="theme-l"] [role="radio"]:nth-child(3)');
    await waitForStored({ theme: "dark", accent: "#a142f4" });
    expect(await look()).toEqual({ theme: "dark", accent: purple.dark.accent, checked: purple.dark.accent });
  });

  it("keeps them after a reload", async () => {
    await page.reload();
    await page.waitForSelector("#s-appearance");
    expect(await look()).toEqual({ theme: "dark", accent: purple.dark.accent, checked: purple.dark.accent });
    await page.click('[aria-labelledby="theme-l"] [role="radio"]:nth-child(2)');
    expect((await look()).accent).toBe(purple.light.accent);
  });

  it("takes a typed hex and returns to exact Chrome blue for the default", async () => {
    const hex = await page.$('input[aria-label="Custom accent hex code"]');
    await hex!.focus();
    await hex!.evaluate((el) => (el as HTMLInputElement).select());
    await hex!.type("#0B8043");
    await page.keyboard.press("Tab");
    await waitForStored({ accent: "#0b8043" });
    expect((await look()).accent).toBe(deriveAccent("#0b8043").light.accent);

    await page.click('.swatches [aria-label="Blue"]');
    await waitForStored({ accent: "" });
    expect((await look()).accent).toBe("#1a73e8");
  });
});
