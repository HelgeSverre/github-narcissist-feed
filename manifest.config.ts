import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Narcissist Feed for GitHub",
  short_name: "Narcissist Feed",
  description: pkg.description,
  version: pkg.version,
  homepage_url: pkg.homepage,
  author: { email: pkg.author.email },
  minimum_chrome_version: "120",
  icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
  action: { default_title: "Open Narcissist Feed", default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" } },
  offline_enabled: true,
  background: { service_worker: "src/background/index.ts", type: "module" },
  permissions: ["storage", "alarms"],
  host_permissions: ["https://api.github.com/*"],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com https://github.com; connect-src https://api.github.com",
  },
});
