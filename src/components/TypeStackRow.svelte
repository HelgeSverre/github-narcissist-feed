<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { KIND_LABELS, kindIcon, type TypeStack } from "../lib/feed";
  import { fmtTime } from "../lib/format";
  import Icon from "./Icon.svelte";
  import Avatar from "./Avatar.svelte";
  import Row from "./Row.svelte";

  let { g }: { g: TypeStack } = $props();
  const open = $derived(app.expanded.has(g.key));
  const [icon, cls] = $derived(kindIcon(g.items[0]));
  const actors = $derived([...new Set(g.items.map((e) => e.actor))]);
  const repos = $derived([...new Set(g.items.map((e) => e.repo))]);
  const noun = $derived(KIND_LABELS[g.kind].toLowerCase());

  function toggle() {
    app.expanded = app.toggleSet(app.expanded, g.key, !open);
  }
</script>

<div
  class="row stack"
  class:open
  role="button"
  tabindex="0"
  aria-expanded={open}
  title="{g.items.length} {noun} by {actors.length} {actors.length === 1 ? 'person' : 'people'}"
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
  <span class="avs"
    >{#each actors.slice(0, 2) as a (a)}<Avatar login={a} src={g.items.find((e) => e.actor === a)?.avatar ?? ""} />{/each}</span
  >
  <span class="txt">
    <b>{g.items.length} {noun}</b>
    <span class="ttl" style="margin-left:0"
      >by {#if actors.length === 1}<a href="https://github.com/{actors[0]}" target="_blank" rel="noopener">{actors[0]}</a
        >{:else}{actors.length} people{/if} on</span
    >
    {#each repos.slice(0, 3) as r, i (r)}{#if i > 0},
      {/if}<a href="https://github.com/{r}" target="_blank" rel="noopener">{r}</a>{/each}
    {#if repos.length > 3}<span class="ttl">+{repos.length - 3} more</span>{/if}
  </span>
  <span class="extra"><span class="cnt">{g.items.length} <Icon name="chevron-down" size={14} /></span></span>
  <span class="time">{fmtTime(new Date(g.at), app.settings)}</span>
</div>
{#if open}
  <div class="kids">
    {#each g.items as e (e.id)}<Row {e} />{/each}
  </div>
{/if}
