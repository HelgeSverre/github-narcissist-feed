<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { flat, kindIcon, stackSummary, type Stack } from "../lib/feed";
  import { fmtTime } from "../lib/format";
  import Icon from "./Icon.svelte";
  import Avatar from "./Avatar.svelte";
  import Row from "./Row.svelte";

  let { g }: { g: Stack } = $props();
  const evs = $derived(flat(g));
  const key = $derived(g.key + g.anchor);
  const open = $derived(app.expanded.has(key));
  const kinds = $derived(new Set(evs.map((e) => e.kind)));
  const [icon, cls] = $derived(kinds.size > 1 ? ["stack", "k-neutral"] : kindIcon(evs[0]));
  const sum = $derived(stackSummary(g));

  function toggle() {
    app.expanded = app.toggleSet(app.expanded, key, !open);
  }
</script>

<div
  class="row stack"
  class:open
  role="button"
  tabindex="0"
  aria-expanded={open}
  title="{evs.length} items between {fmtTime(new Date(evs.at(-1)!.at), app.settings)} and {fmtTime(new Date(g.at), app.settings)}"
  onclick={(ev) => {
    if (!(ev.target as HTMLElement).closest("a")) toggle();
  }}
  onkeydown={(ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggle();
    }
  }}
>
  <Icon name={icon} {cls} />
  <Avatar login={evs[0].actor} src={evs[0].avatar} />
  <span class="txt">
    <a href="https://github.com/{evs[0].actor}" target="_blank" rel="noopener">{evs[0].actor}</a>
    {sum.text} in
    <a href="https://github.com/{sum.target}" target="_blank" rel="noopener">{sum.target}</a>
    {#if sum.repos > 1 && !sum.target.includes("/")}<span class="ttl">across {sum.repos} repositories</span>{/if}
  </span>
  <span class="extra"><span class="cnt">{evs.length} <Icon name="chevron-down" size={14} /></span></span>
  <span class="time">{fmtTime(new Date(g.at), app.settings)}</span>
</div>
{#if open}
  <div class="kids">
    {#each evs as e (e.id)}<Row {e} />{/each}
  </div>
{/if}
