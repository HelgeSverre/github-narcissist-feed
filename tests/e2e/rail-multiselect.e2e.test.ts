/**
 * Shift+Arrow multi-selection in the rail's Activity list (src/lib/multiselect.ts). Offline: no GitHub token needed.
 */
import type { Page } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { launchExtension, type ExtensionSession } from "./helpers/browser";

let ext: ExtensionSession;
let page: Page;
beforeAll(async () => {
  ext = await launchExtension();
  await ext.inWorker(async () => {
    await chrome.storage.sync.set({ settings: { username: "octo", owners: [{ login: "octo", type: "user", on: true }] } });
  });
  page = await ext.openPage({ ready: "#rsec-activity label.frow" });
});
afterAll(async () => {
  await ext?.close();
});
afterEach(async ({ task }) => {
  await ext.afterTest(task);
});

const state = () =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLLabelElement>("#rsec-activity label.frow")].map((l) => ({
      label: l.querySelector(".lbl")?.textContent?.trim(),
      checked: l.querySelector("input")?.checked,
      selected: l.classList.contains("msel"),
    })),
  );
const selectedLabels = async () => (await state()).filter((r) => r.selected).map((r) => r.label);
const checkedOf = async (...labels: string[]) => {
  const rows = await state();
  return labels.map((l) => rows.find((r) => r.label === l)?.checked);
};
const syncedKinds = async () => (await ext.syncStorage()).view?.kinds;

describe("Activity multi-select", () => {
  it("extends a selection with Shift+ArrowDown and shrinks it with Shift+ArrowUp", async () => {
    await page.focus("#rsec-activity label.frow input");
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await selectedLabels()).toEqual(["Stars", "Forks", "Issues"]);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.up("Shift");
    expect(await selectedLabels()).toEqual(["Stars", "Forks"]);
  });

  it("toggles every selected checkbox with one Space, then back", async () => {
    await page.keyboard.press("Space");
    expect(await checkedOf("Stars", "Forks", "Issues")).toEqual([false, false, true]);
    await vi.waitFor(async () => expect(await syncedKinds()).toEqual(["issue", "pr", "comment", "review", "release"]), { timeout: 5_000 });
    await page.keyboard.press("Space");
    expect(await checkedOf("Stars", "Forks", "Issues")).toEqual([true, true, true]);
  });

  it("checks all when the selection is mixed", async () => {
    await page.keyboard.press("Escape");
    expect(await selectedLabels()).toEqual([]);
    await page.focus("#rsec-activity label.frow:nth-child(2) input");
    await page.keyboard.press("Space"); // uncheck Forks on its own
    expect(await checkedOf("Forks")).toEqual([false]);
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.up("Shift");
    expect(await selectedLabels()).toEqual(["Stars", "Forks"]);
    await page.keyboard.press("Space");
    expect(await checkedOf("Stars", "Forks")).toEqual([true, true]);
  });

  it("clears the selection on a plain arrow key", async () => {
    await page.keyboard.press("ArrowDown");
    expect(await selectedLabels()).toEqual([]);
  });
});
