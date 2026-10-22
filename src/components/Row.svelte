<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { kindIcon, verbText } from "../lib/feed";
  import { fmtDateTime, fmtTime } from "../lib/format";
  import type { FeedEvent } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Avatar from "./Avatar.svelte";

  let { e }: { e: FeedEvent } = $props();
  const [icon, cls] = $derived(kindIcon(e));
  const d = $derived(new Date(e.at));
  const tail = $derived(
    e.kind === "star" || e.kind === "fork" || e.kind === "unstar" || e.kind === "unfork"
      ? null
      : e.kind === "release"
        ? { num: e.tag ?? "", title: e.title && e.title !== e.tag && e.title !== (e.tag ?? "").replace(/^v/, "") ? e.title : "" }
        : { num: `#${e.number}`, title: e.title ?? "" },
  );

  function open(ev: MouseEvent | KeyboardEvent) {
    if ((ev.target as HTMLElement).closest("a")) return;
    window.open(e.url, "_blank", "noopener");
  }
</script>

<div
  class="row"
  class:dim={e.kind === "unstar" || e.kind === "unfork"}
  role="link"
  tabindex="0"
  title="{e.title ?? e.repo} · {fmtDateTime(d, app.settings)}"
  onclick={open}
  onkeydown={(ev) => {
    if (ev.key === "Enter") open(ev);
  }}
>
  <Icon name={icon} {cls} />
  <Avatar login={e.actor} src={e.avatar} />
  <span class="txt">
    <a href="https://github.com/{e.actor}" target="_blank" rel="noopener">{e.actor}</a>
    {verbText(e)}
    <a href="https://github.com/{e.repo}" target="_blank" rel="noopener">{e.repo}</a>{#if e.private}<Icon
        name="lock"
        cls="lock"
        size={12}
      />{/if}
    {#if tail}<span class="num">{tail.num}</span><span class="ttl">{tail.title}</span>{/if}
  </span>
  <span class="extra">
    {#if e.kind === "star" || e.kind === "unstar"}<Icon name="star" size={14} /> {e.stars?.toLocaleString() ?? ""}
    {:else if e.kind === "fork" || e.kind === "unfork"}<Icon name="repo-forked" size={14} /> {e.forks ?? ""}
    {:else if e.comments}<Icon name="comment" size={14} /> {e.comments}{/if}
  </span>
  <span class="time">{fmtTime(d, app.settings)}</span>
</div>

<style>
  .row.dim {
    opacity: 0.65;
  }
</style>
