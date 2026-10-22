import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [svelte(), crx({ manifest })],
  build: {
    target: "chrome120",
    sourcemap: false,
    // The feed page is not referenced by the manifest (the toolbar icon opens it), so CRXJS must be told to build it.
    rollupOptions: { input: { index: "index.html" } },
  },
});
