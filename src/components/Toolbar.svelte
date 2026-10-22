<script lang="ts">
  import { app, send } from "../lib/app.svelte";
  import { GROUPS } from "../lib/feed";
  import { relative } from "../lib/format";
  import Icon from "./Icon.svelte";

  const groupKeys = $derived(app.groupKeys);
  const allCollapsed = $derived(groupKeys.length > 0 && groupKeys.every((k) => app.collapsed.has(k)));
  const updated = $derived(app.refreshing ? "Refreshing…" : "Updated " + relative(app.status.lastQuickAt, app.now));

  function toggleAll() {
    app.collapsed = allCollapsed ? new Set() : new Set(groupKeys);
  }
  function refresh() {
    if (app.refreshing) return;
    void send({ type: "refresh", mode: "quick" });
  }
</script>

{#if app.page === "feed"}
  <div class="tbB">
    <div class="bar">
      <div class="search bare">
        <Icon name="search" />
        <input
          id="q"
          type="search"
          placeholder="Search repository, person or title"
          bind:value={app.q}
          oninput={() => (app.shown = 40)}
          autocomplete="off"
          aria-label="Search"
        />
        <kbd>/</kbd>
      </div>
      <span class="bsep"></span>
      <div class="gseg flat" role="radiogroup" aria-label="Group by">
        {#each GROUPS as [v, l] (v)}
          <button
            type="button"
            role="radio"
            aria-checked={app.view.group === v}
            class:on={app.view.group === v}
            onclick={() => app.setGroup(v)}>{l}</button
          >
        {/each}
      </div>
      <span class="bsep"></span>
      <button
        type="button"
        class="tbi in"
        onclick={toggleAll}
        title={allCollapsed ? "Expand all groups" : "Collapse all groups"}
        aria-label={allCollapsed ? "Expand all groups" : "Collapse all groups"}
      >
        <Icon name={allCollapsed ? "unfold" : "fold"} />
      </button>
    </div>
    <button type="button" class="tbi txt" onclick={refresh} title="Refresh now" aria-label="Refresh now" disabled={!!app.refreshing}>
      <Icon name="sync" cls={app.refreshing ? "spin" : ""} /><span>{updated}</span>
    </button>
    <button
      type="button"
      class="tbi"
      onclick={() => {
        app.page = "settings";
        window.scrollTo(0, 0);
      }}
      title="Settings"
      aria-label="Settings"><Icon name="gear" /></button
    >
  </div>
{:else}
  <nav class="crumbs" aria-label="Breadcrumb">
    <button
      type="button"
      class="ibtn"
      onclick={() => {
        app.page = "feed";
        window.scrollTo(0, 0);
      }}
      title="Back to feed"
      aria-label="Back to feed"><Icon name="arrow-left" /></button
    >
    <button
      type="button"
      class="crumb"
      onclick={() => {
        app.page = "feed";
        window.scrollTo(0, 0);
      }}>Feed</button
    >
    <Icon name="chevron-right" cls="csep" />
    <span class="crumb cur" aria-current="page">Settings</span>
  </nav>
{/if}

<style>
  :global(.ic.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.ic.spin) {
      animation: none;
    }
  }
</style>
