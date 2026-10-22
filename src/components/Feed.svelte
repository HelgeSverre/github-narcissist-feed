<script lang="ts">
  import { app, send } from "../lib/app.svelte";
  import { filterEvents, groupItems, isStack, isTypeStack, pageGroups, stackEvents, typeStackGroup } from "../lib/feed";
  import { groupLabel } from "../lib/format";
  import Icon from "./Icon.svelte";
  import Row from "./Row.svelte";
  import StackRow from "./StackRow.svelte";
  import TypeStackRow from "./TypeStackRow.svelte";
  import Skeleton from "./Skeleton.svelte";

  const PAGE = 40;
  const filtered = $derived(
    filterEvents(
      app.events,
      {
        kinds: app.kindSet,
        owners: app.ownersOn,
        hideMe: app.view.hideMe,
        hideBots: app.view.hideBots,
        period: app.view.period,
        repos: app.repoSet,
        q: app.q,
      },
      app.me,
      app.now,
      app.settings.showUnstars,
    ),
  );
  const items = $derived(stackEvents(filtered, app.settings));
  const allGroups = $derived.by(() => {
    const gs = groupItems(items, app.view.group, app.settings.weekStart);
    if (app.settings.stack && app.settings.stackScope === "type") for (const g of gs) g.items = typeStackGroup(g.items, g.key);
    return gs;
  });
  const paged = $derived(pageGroups(allGroups, (k) => app.isGroupCollapsed(k), app.shown));
  const groups = $derived(paged.groups);
  const more = $derived(paged.more);
  const loadingFirst = $derived(!app.events.length && !!app.refreshing);

  function observe(node: HTMLElement) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) app.shown += PAGE;
      },
      { rootMargin: "400px" },
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }
</script>

{#if app.hasToken && app.status.starsAccess === false}
  <p class="note warnline">
    <Icon name="star" size={14} /> Stars are missing: your token cannot list stargazers. GitHub only allows that for fine-grained tokens with
    <b>Contents: Read and write</b>. Change it on the token page, then refresh.
    <button type="button" class="linkbtn" onclick={() => (app.page = "settings")}>Settings</button>
  </p>
{/if}
{#if !app.hasToken}
  <div class="card empty">
    Add a GitHub personal access token in Settings to load your feed.<br /><button
      type="button"
      class="btn"
      style="margin-top:12px"
      onclick={() => (app.page = "settings")}>Open Settings</button
    >
  </div>
{:else if loadingFirst}
  <div class="day"><span class="sk" style="width:180px;height:12px"></span></div>
  <Skeleton rows={8} />
{:else if !app.events.length}
  <div class="card empty">
    {#if app.status.lastError}<span class="err">{app.status.lastError}</span><br />{:else}No activity loaded yet.<br />{/if}
    <button type="button" class="btn" style="margin-top:12px" onclick={() => send({ type: "refresh", mode: "full" })}>Refresh now</button>
  </div>
{:else if !groups.length}
  <div class="card empty">Nothing matches these filters.</div>
{:else}
  {#each groups as g (g.key)}
    {@const c = app.isGroupCollapsed(g.key)}
    {@const n = g.total}
    <button type="button" class="day" class:collapsed={c} aria-expanded={!c} onclick={() => app.toggleGroup(g.key)}>
      <Icon name="chevron-down" /><span>{groupLabel(g.start, app.view.group, app.settings, app.now)}</span><span class="dcnt">{n}</span>
    </button>
    {#if !c}
      <div class="card">
        {#each g.items as it (isStack(it) ? it.key + it.anchor : isTypeStack(it) ? it.key : it.single.id)}
          {#if isStack(it)}<StackRow g={it} />{:else if isTypeStack(it)}<TypeStackRow g={it} />{:else}<Row e={it.single} />{/if}
        {/each}
      </div>
    {/if}
  {/each}
  {#if more}
    <div class="sentinel" use:observe></div>
    <Skeleton rows={3} />
  {:else if items.length > PAGE}
    <div class="end">That is everything for this period.</div>
  {/if}
{/if}
{#if app.status.lastError && app.events.length}
  <p class="err" style="margin-top:12px">{app.status.lastError}</p>
{/if}

<style>
  .warnline {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin: 12px 0 0;
  }
  .linkbtn {
    color: var(--accent);
    font-weight: 500;
  }
</style>
