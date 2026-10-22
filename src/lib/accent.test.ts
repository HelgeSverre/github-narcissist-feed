import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, DEFAULT_ACCENT, accentTokens, accentVars, contrast, deriveAccent } from "./accent";

const LIGHT = { card: "#ffffff", page: "#f1f3f4", alpha: 0.1 };
const DARK = { card: "#292a2d", page: "#202124", alpha: 0.16 };
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** `fg` at `alpha` over `bg`, rounded like the browser's 8-bit result. */
const over = (fg: string, bg: string, alpha: number) => {
  const f = rgb(fg);
  return `#${rgb(bg)
    .map((v, i) =>
      Math.round(v + (f[i] - v) * alpha)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};

const SEEDS = [
  ...ACCENT_PRESETS.map((p) => p.hex).filter(Boolean),
  "#1a73e8",
  "#ffffff",
  "#000000",
  "#ffff00",
  "#a3e635",
  "#ff0000",
  "#0000ff",
  "#00ffff",
  "#808080",
  "#3d0a0a",
  "#fdf6e3",
];

describe("contrast", () => {
  it("matches known WCAG 2 ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrast("#ffffff", "#767676")).toBeCloseTo(4.54, 2);
  });
});

describe("deriveAccent", () => {
  it.each(SEEDS)("%s: accent text reads at 4.5:1 on cards, the page and its own tint, in both themes", (seed) => {
    const d = deriveAccent(seed);
    for (const [t, bg] of [
      [d.light, LIGHT],
      [d.dark, DARK],
    ] as const) {
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/);
      for (const surface of [bg.card, bg.page, over(t.accent, bg.card, bg.alpha), over(t.accent, bg.page, bg.alpha)])
        expect(contrast(t.accent, surface), `${t.accent} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.onAccent, t.accent), `check mark ${t.onAccent} on ${t.accent}`).toBeGreaterThanOrEqual(4.5);
      expect(t.accentBg).toBe(`rgba(${rgb(t.accent).join(", ")}, ${bg.alpha})`);
    }
  });

  it("keeps a seed that already reads well on light pages unchanged", () => {
    expect(deriveAccent("#5f6368").light.accent).toBe("#5f6368");
    expect(deriveAccent("#000000").light.accent).toBe("#000000");
  });

  it("darkens light-theme and lightens dark-theme accents, keeping the hue family", () => {
    for (const [seed, channel] of [
      ["#d93025", 0],
      ["#188038", 1],
      ["#1a73e8", 2],
    ] as const) {
      const { light, dark } = deriveAccent(seed);
      for (const hex of [light.accent, dark.accent]) {
        const c = rgb(hex);
        expect(Math.max(...c), `${seed} -> ${hex}`).toBe(c[channel]);
      }
      expect(contrast(dark.accent, "#000000")).toBeGreaterThan(contrast(light.accent, "#000000"));
    }
  });

  it("gives a light check mark on dark accents and a dark one on light accents", () => {
    expect(deriveAccent("#188038").light.onAccent).toBe("#ffffff");
    expect(deriveAccent("#188038").dark.onAccent).toBe("#202124");
  });
});

describe("accent setting", () => {
  it("leaves Chrome blue to the stylesheet for the default and anything malformed", () => {
    for (const v of ["", "blue", "#12345"]) {
      expect(accentVars(v)).toEqual({});
      expect(accentTokens(v)).toEqual(DEFAULT_ACCENT);
    }
  });

  it("sets light and dark variables for a custom hex", () => {
    const { light, dark } = deriveAccent("#a142f4");
    expect(accentVars("#A142F4")).toEqual({
      "--accent-l": light.accent,
      "--accent-bg-l": light.accentBg,
      "--on-accent-l": light.onAccent,
      "--accent-d": dark.accent,
      "--accent-bg-d": dark.accentBg,
      "--on-accent-d": dark.onAccent,
    });
  });
});
