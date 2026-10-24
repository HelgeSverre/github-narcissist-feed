<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { kindIcons, type DisplayEvent } from "./fixtures";
  let {
    event,
    index,
    total,
    next,
    previous,
    open,
  }: { event: DisplayEvent; index: number; total: number; next: () => void; previous: () => void; open: () => void } = $props();
</script>

<section class="spotlight screen-content" aria-label="Spotlight">
  <div class="spotlight-story">
    <div class="person">
      <span class="display-avatar">{event.initials}</span><span><strong>@{event.actor}</strong><span>{event.time}</span></span>
    </div>
    <button class="spotlight-open" onclick={open} aria-label={`Read activity from ${event.actor}`}>
      <span class="event-action"><Icon name={kindIcons[event.kind]} size={30} />{event.action}</span>
      <h1>{event.repo}</h1>
      {#if event.title}<p class="spotlight-title">“{event.title}”</p>{:else}<p class="spotlight-subtitle">
          A little recognition for your work.
        </p>{/if}
      <span class="read-hint">Tap to take a closer look <Icon name="chevron-right" /></span>
    </button>
    <div class="event-pager">
      <button onclick={previous} aria-label="Previous event"><Icon name="arrow-left" size={22} /></button><span
        >{index + 1} <span class="muted">/ {total} recent events</span></span
      ><button onclick={next} aria-label="Next event"><Icon name="chevron-right" size={22} /></button>
    </div>
  </div>
  <aside class="spotlight-aside">
    <h2>A good week<br />for your projects.</h2>
    <p>Observed in this sample</p>
    <dl class="week-summary">
      <div>
        <dt><Icon name="star" />Stars</dt>
        <dd>36</dd>
      </div>
      <div>
        <dt><Icon name="repo-forked" />Forks</dt>
        <dd>6</dd>
      </div>
      <div>
        <dt><Icon name="comment" />Conversations</dt>
        <dd>14</dd>
      </div>
    </dl>
    <div class="tiny-history" aria-hidden="true">
      {#each [3, 5, 4, 8, 6, 10, 7] as n}<span style:height={`${n * 7}px`}></span>{/each}
    </div>
    <p class="history-label">The last seven days</p>
  </aside>
</section>
