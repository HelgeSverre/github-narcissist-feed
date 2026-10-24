import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { crx } from "@crxjs/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";
import manifest from "./manifest.config.ts";

export default defineConfig(({ mode }) => ({
  base: mode === "web" ? process.env.VITE_BASE_PATH || "/" : "/",
  plugins: [
    svelte(),
    ...(mode === "web" ? [] : [crx({ manifest })]),
    VitePWA({
      disable: mode !== "web",
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["boot.js", "favicon.svg", "icons/*.png"],
      manifest: {
        name: "Narcissist Feed for GitHub",
        short_name: "Narcissist Feed",
        description: "Your GitHub repository activity in one feed.",
        id: "./",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#202124",
        theme_color: "#202124",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"], navigateFallback: "index.html" },
    }),
  ],
  build: {
    target: "es2022",
    outDir: mode === "web" ? "dist-web" : "dist",
    sourcemap: false,
    // The feed page is not referenced by the manifest (the toolbar icon opens it), so CRXJS must be told to build it.
    rollupOptions: { input: { index: "index.html" } },
  },
}));
