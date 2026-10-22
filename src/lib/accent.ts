/**
 * Accent colour: presets, hex parsing and per-theme derivation.
 *
 * One seed hex becomes four tokens per theme (--accent, --accent-bg, --focus via --accent, --on-accent). The seed keeps
 * its OKLCH hue; lightness is first nudged towards the theme's preferred lightness (darker accents on light pages,
 * lighter, pastel accents on dark ones, like Chrome's own #1a73e8 / #8ab4f8 pair), then moved further until text in the
 * accent colour reaches WCAG 4.5:1 on every surface it is drawn on: cards, the page, and its own selected-state tint
 * over either. Chroma is reduced only as far as needed to stay inside sRGB.
 *
 * The default ("") emits no overrides, so app.css keeps Chrome's exact blue.
 */

type RGB = [number, number, number];

export interface ThemeAccent {
  accent: string;
  /** translucent tint for selected and hover states */
  accentBg: string;
  /** check marks and text on a filled accent */
  onAccent: string;
}

/** Chrome's tab group colours. `""` is the built-in Chrome blue. */
export const ACCENT_PRESETS: readonly { name: string; hex: string }[] = [
  { name: "Blue", hex: "" },
  { name: "Cyan", hex: "#007b83" },
  { name: "Green", hex: "#188038" },
  { name: "Yellow", hex: "#f9ab00" },
  { name: "Orange", hex: "#fa903e" },
  { name: "Red", hex: "#d93025" },
  { name: "Pink", hex: "#d01884" },
  { name: "Purple", hex: "#a142f4" },
  { name: "Grey", hex: "#5f6368" },
];

/** What the default accent looks like, for swatches and the colour picker. Keep in step with app.css. */
export const DEFAULT_ACCENT: { light: ThemeAccent; dark: ThemeAccent; seed: string } = {
  seed: "#1a73e8",
  light: { accent: "#1a73e8", accentBg: "rgba(26, 115, 232, 0.1)", onAccent: "#ffffff" },
  dark: { accent: "#8ab4f8", accentBg: "rgba(138, 180, 248, 0.16)", onAccent: "#292a2d" },
};

const THEMES = {
  light: { card: "#ffffff", page: "#f1f3f4", alpha: 0.1, preferredL: 0.62, dark: false },
  dark: { card: "#292a2d", page: "#202124", alpha: 0.16, preferredL: 0.76, dark: true },
} as const;
const TEXT_CONTRAST = 4.5;
const ON_ACCENT_DARK = "#202124";

/** `#abc`, `abc`, `#aabbcc` or `aabbcc` (any case) as lowercase `#aabbcc`; anything else is null. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

// ---------- sRGB, OKLab, OKLCH (Björn Ottosson's reference matrices) ----------

const hexToRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
const rgbToHex = (rgb: RGB) =>
  `#${rgb
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const fromLinear = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function rgbToOklch(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** Linear sRGB; may fall outside [0, 1] when the colour is out of gamut. */
function oklchToLinear(L: number, C: number, h: number): RGB {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (lin: RGB) => lin.every((v) => v >= -1e-7 && v <= 1 + 1e-7);

/** OKLCH to an 8-bit sRGB hex, keeping L and h and lowering C (bisection) until the colour fits in sRGB. */
function oklchToHex(L: number, C: number, h: number): string {
  let lin = oklchToLinear(L, C, h);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear(L, lo, h);
  }
  return rgbToHex(lin.map(fromLinear) as RGB);
}

// ---------- WCAG 2 contrast ----------

const luminance = (rgb: RGB) => {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** `fg` at `alpha` over `bg`, the way the browser composites an rgba() background. */
const over = (fg: string, bg: string, alpha: number) => {
  const f = hexToRgb(fg);
  return rgbToHex(hexToRgb(bg).map((v, i) => v + (f[i] - v) * alpha) as RGB);
};

// ---------- derivation ----------

function deriveTheme(seed: string, t: (typeof THEMES)[keyof typeof THEMES]): ThemeAccent {
  const [L0, C, h] = rgbToOklch(hexToRgb(seed));
  const worst = (hex: string) =>
    Math.min(...[t.card, t.page, over(hex, t.card, t.alpha), over(hex, t.page, t.alpha)].map((bg) => contrast(hex, bg)));
  const at = (L: number) => oklchToHex(L, C, h);

  // Start at the seed, moved to the theme's side of the preferred lightness; then move away from the background
  // (darker on light themes, lighter on dark ones) only as far as contrast requires. Black and white always pass.
  let fail = t.dark ? Math.max(L0, t.preferredL) : Math.min(L0, t.preferredL);
  let pass = t.dark ? 1 : 0;
  if (worst(at(fail)) >= TEXT_CONTRAST) pass = fail;
  else
    for (let i = 0; i < 30; i++) {
      const mid = (fail + pass) / 2;
      if (worst(at(mid)) >= TEXT_CONTRAST) pass = mid;
      else fail = mid;
    }
  const accent = at(pass);
  const [r, g, b] = hexToRgb(accent).map((v) => Math.round(v * 255));
  return {
    accent,
    accentBg: `rgba(${r}, ${g}, ${b}, ${t.alpha})`,
    onAccent: contrast("#ffffff", accent) >= contrast(ON_ACCENT_DARK, accent) ? "#ffffff" : ON_ACCENT_DARK,
  };
}

/** Light and dark tokens for a seed hex (`#rrggbb`). */
export function deriveAccent(seed: string): { light: ThemeAccent; dark: ThemeAccent } {
  return { light: deriveTheme(seed, THEMES.light), dark: deriveTheme(seed, THEMES.dark) };
}

/** Tokens for a stored accent setting: the default for `""` (or anything malformed), derived otherwise. */
export function accentTokens(accent: string): { light: ThemeAccent; dark: ThemeAccent } {
  const hex = normalizeHex(accent);
  return hex ? deriveAccent(hex) : DEFAULT_ACCENT;
}

/**
 * CSS custom properties that app.css reads per theme (`--accent-l` in light, `--accent-d` in dark, …).
 * Empty for the default, so the stylesheet's own Chrome-blue values apply.
 */
export function accentVars(accent: string): Record<string, string> {
  const hex = normalizeHex(accent);
  if (!hex) return {};
  const { light, dark } = deriveAccent(hex);
  return {
    "--accent-l": light.accent,
    "--accent-bg-l": light.accentBg,
    "--on-accent-l": light.onAccent,
    "--accent-d": dark.accent,
    "--accent-bg-d": dark.accentBg,
    "--on-accent-d": dark.onAccent,
  };
}

/** Every property name accentVars can set, so switching back to the default can remove them all. */
export const ACCENT_VAR_NAMES = ["--accent-l", "--accent-bg-l", "--on-accent-l", "--accent-d", "--accent-bg-d", "--on-accent-d"];
