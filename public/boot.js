// Applies the cached theme, density and accent before first paint (index.html loads this render-blocking).
// The cache is written by applyTheme() in src/lib/app.svelte.ts; the synced settings remain the source of truth.
try {
  const cached = JSON.parse(localStorage.getItem("appearance") || "null");
  if (cached && typeof cached === "object") {
    const root = document.documentElement;
    if (cached.theme === "light" || cached.theme === "dark") root.setAttribute("data-theme", cached.theme);
    if (cached.density === "compact") root.setAttribute("data-density", "compact");
    for (const [name, value] of Object.entries(cached.vars || {}))
      if (/^--[a-z-]+$/.test(name) && typeof value === "string") root.style.setProperty(name, value);
  }
} catch {
  // No cache or unreadable: the app applies the settings once they load.
}
