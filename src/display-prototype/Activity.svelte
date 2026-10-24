<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { activity, kindIcons, type DisplayEvent } from "./fixtures";
  let { filter, open, clearFilter }: { filter: string; open: (event: DisplayEvent) => void; clearFilter: () => void } = $props();
  let page = $state(0);
  const filtered = $derived(filter ? activity.filter((event) => event.repo === filter) : activity);
  const shown = $derived(filtered.slice(page * 4, page * 4 + 4));
  $effect(() => {
    void filter;
    page = 0;
  });
</script>

<section class="activity-screen screen-content" aria-labelledby="activity-title">
  <div class="screen-heading">
    <div>
      <h1 id="activity-title">While you were away.</h1>
      <p>{filter || "The latest from people finding and using your work."}</p>
    </div>
    {#if filter}<button class="touch-button" onclick={clearFilter}>All repositories <Icon name="x" /></button>{:else}<span
        class="quiet-label">Today · {activity.length} sample events</span
      >{/if}
  </div>
  <div class="display-activity-list">
    {#each shown as event (event.id)}
      <button class="display-activity-row" onclick={() => open(event)}>
        <span class="display-avatar small">{event.initials}</span><span class="row-icon"
          ><Icon name={kindIcons[event.kind]} size={22} /></span
        >
        <span class="row-content"
          ><span><strong>@{event.actor}</strong> <span class="muted">{event.action}</span></span><span class="row-repo">{event.repo}</span
          >{#if event.title}<span class="row-title">{event.title}</span>{/if}</span
        >
        <span class="row-time">{event.time}</span><Icon name="chevron-right" size={22} />
      </button>
    {/each}
  </div>
  <div class="list-pager">
    <span>{page * 4 + 1}–{Math.min(filtered.length, page * 4 + 4)} of {filtered.length} events</span>
    <div>
      <button class="touch-button" disabled={page === 0} onclick={() => page--}><Icon name="arrow-left" />Newer</button><button
        class="touch-button"
        disabled={(page + 1) * 4 >= filtered.length}
        onclick={() => page++}>Older<Icon name="chevron-right" /></button
      >
    </div>
  </div>
</section>
