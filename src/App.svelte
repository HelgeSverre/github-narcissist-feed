<script lang="ts">
  import { onMount } from "svelte";
  import { app, send } from "./lib/app.svelte";
  import Rail from "./components/Rail.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import Feed from "./components/Feed.svelte";
  import Settings from "./components/Settings.svelte";
  import Trends from "./components/Trends.svelte";
  import Toc from "./components/Toc.svelte";

  onMount(async () => {
    await app.boot();
    if (!app.hasToken) app.page = "settings";
    else if (!app.events.length) void send({ type: "refresh", mode: "full" });
    document.addEventListener("keydown", (ev) => {
      const tag = (ev.target as HTMLElement).tagName;
      if (ev.key === "/" && tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA" && app.page === "feed") {
        ev.preventDefault();
        document.getElementById("q")?.focus();
      }
    });
  });
</script>

{#if app.ready}
  <aside class="rail" id="rail"><Rail /></aside>
  <main class="main">
    <div class="toolbar" id="toolbar"><Toolbar /></div>
    <div class="body">
      <div class="col" id="col">
        {#if app.page === "feed"}<Feed />{:else}<Settings />{/if}
      </div>
      {#if app.page === "feed" && app.settings.trends}
        <aside class="side" id="side"><Trends /></aside>
      {:else if app.page === "settings"}
        <aside class="side narrow" id="side"><Toc /></aside>
      {/if}
    </div>
  </main>
{/if}
