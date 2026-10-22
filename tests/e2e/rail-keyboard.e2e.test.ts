/**
 * Keyboard navigation in the filter rail (src/lib/railnav.ts). Needs no GitHub token: the profile is seeded straight
 * into chrome.storage, so these tests run offline.
 */
import type { Page } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectRail, launchExtension, type ExtensionSession } from "./helpers/browser";

let ext: ExtensionSession;
let page: Page;
beforeAll(async () => {
  ext = await launchExtension();
  await ext.inWorker(async () => {
    await chrome.storage.sync.set({
      settings: {
        username: "octo",
        owners: [
          { login: "octo", type: "user", on: true },
          { login: "acme", type: "org", on: true },
        ],
      },
    });
  });
  page = await ext.openPage({ ready: '#rail h2[data-sec="owners"] ~ .rsec label.frow' });
});
afterAll(async () => {
  await ext?.close();
});
afterEach(async ({ task }) => {
  await ext.afterTest(task);
});

/** Describes the focused element: `header:<section>`, `<type>:<label>` for rail inputs, or the button text. */
const focused = () =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    if (a.classList.contains("sech")) return `header:${a.closest("h2")?.getAttribute("data-sec")}`;
    if (a instanceof HTMLInputElement) return `${a.type}:${a.closest("label")?.querySelector(".lbl")?.textContent?.trim() ?? ""}`;
    return a.getAttribute("aria-label") ?? a.textContent?.trim() ?? a.tagName;
  });

const press = async (...keys: Parameters<Page["keyboard"]["press"]>[0][]) => {
  for (const k of keys) await page.keyboard.press(k);
  return focused();
};

describe("rail keyboard navigation", () => {
  it("moves through items with Up/Down and jumps with Home/End", async () => {
    await page.focus('#rail h2[data-sec="activity"] .sech');
    expect(await press("ArrowDown")).toBe("checkbox:Stars");
    expect(await press("ArrowDown", "ArrowDown", "ArrowDown")).toMatch(/^Show all/);
    expect(await press("ArrowDown")).toBe("header:owners");
    expect(await press("ArrowDown")).toBe("Add users or organizations");
    expect(await press("ArrowDown")).toBe("checkbox:octo");
    expect(await press("ArrowUp")).toBe("Add users or organizations");
    expect(await press("Home")).toBe("header:activity");
    expect(await press("End")).not.toBe("header:activity");
  });

  it("collapses and expands a section from its header, and skips collapsed items", async () => {
    await page.focus('#rail h2[data-sec="owners"] ~ .rsec input');
    expect(await press("ArrowLeft"), "Left inside a section goes to its header").toBe("header:owners");
    expect(await press("ArrowLeft")).toBe("header:owners");
    await expectRail(page, { closedSections: ["owners"], owners: null });
    expect(await press("ArrowDown", "ArrowDown")).toBe("header:people");
    expect(await press("ArrowUp", "ArrowUp", "ArrowRight")).toBe("header:owners");
    await expectRail(page, { closedSections: [] });
    expect(await press("ArrowRight"), "Right on an open header enters it").toBe("checkbox:octo");
  });

  it("moves between Period radios without selecting; Space selects", async () => {
    await page.focus('#rail input[name="period"]:checked');
    const before = await focused();
    const { period } = await page.evaluate(() => ({
      period: document.querySelector<HTMLInputElement>('#rail input[name="period"]:checked')?.value,
    }));
    const next = await press("ArrowDown");
    expect(next).not.toBe(before);
    expect(next).toMatch(/^radio:/);
    await press("ArrowRight");
    await expectRail(page, { period });
    await press("Space");
    await expectRail(page, { period: await page.evaluate(() => (document.activeElement as HTMLInputElement).value) });
    expect(await press("ArrowLeft")).toBe("header:period");
  });
});
