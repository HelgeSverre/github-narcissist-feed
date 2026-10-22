/**
 * Renders assets/icon/icon.svg to the extension icons in public/icons (16, 32, 48, 128 px),
 * a 256 px copy in assets/icon for store listings, and public/favicon.svg for the page tab.
 *
 * Usage: npm run icons
 *
 * Uses the same pinned Chrome for Testing build as the e2e suite (downloaded once into .cache/chrome).
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Browser, detectBrowserPlatform, install } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";

/** Keep in step with CHROME_BUILD_ID in tests/e2e/global-setup.ts so only one build is cached. */
const CHROME_BUILD_ID = "156.0.8078.47";
const SIZES = [16, 32, 48, 128, 256] as const;

const root = resolve(import.meta.dirname, "..");
const platform = detectBrowserPlatform();
if (!platform) throw new Error(`No Chrome for Testing build for ${process.platform}/${process.arch}`);
const { executablePath } = await install({
  browser: Browser.CHROME,
  buildId: CHROME_BUILD_ID,
  cacheDir: resolve(root, ".cache/chrome"),
  platform,
});

const source = await readFile(resolve(root, "assets/icon/icon.svg"), "utf8");
await writeFile(resolve(root, "public/favicon.svg"), source);
console.log("wrote", resolve(root, "public/favicon.svg"));
const svg = source.replace(/\swidth="\d+"\s+height="\d+"/, "");
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-first-run"] });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    const out = size === 256 ? resolve(root, "assets/icon/icon-256.png") : resolve(root, `public/icons/icon-${size}.png`);
    await page.screenshot({ path: out as `${string}.png`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log("wrote", out);
  }
} finally {
  await browser.close();
}
