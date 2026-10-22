<script lang="ts">
  import { app } from "../lib/app.svelte";
  import { PERIODS, RAIL_KINDS, ownerOf, periodStart } from "../lib/feed";
  import { viewIsFiltered, type RailSection } from "../lib/prefs";
  import Icon from "./Icon.svelte";
  import OwnerPopover from "./OwnerPopover.svelte";

  const REPOS_SHOWN = 8;
  let popAnchor = $state<HTMLElement | null>(null);

  const base = $derived.by(() => {
    const start = periodStart(app.view.period, app.now);
    return app.events.filter((e) => Date.parse(e.at) >= start);
  });
  const count = (f: (e: (typeof app.events)[number]) => boolean) => base.filter(f).length;
  // Collapsed list: first three, plus any unchecked kind so an active filter is never hidden.
  const kindsShown = $derived(app.layout.allKinds ? RAIL_KINDS : RAIL_KINDS.filter(([k], i) => i < 3 || !app.kindSet.has(k)));
  /** Selected repositories first (even at 0 events, so a persisted selection can always be seen and cleared), then the rest by activity. */
  const repoCounts = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const e of base) if (app.kindSet.has(e.kind) && app.ownersOn.has(ownerOf(e))) m[e.repo] = (m[e.repo] ?? 0) + 1;
    const picked = app.view.repos.map((r): [string, number] => [r, m[r] ?? 0]).toSorted((a, b) => b[1] - a[1]);
    return [
      ...picked,
      ...Object.entries(m)
        .filter(([r]) => !app.repoSet.has(r))
        .toSorted((a, b) => b[1] - a[1]),
    ];
  });
  const rq = $derived(app.rq.trim().toLowerCase());
  /** Collapsed list never hides a selected repository. */
  const repoLimit = $derived(Math.max(REPOS_SHOWN, app.view.repos.length));
  const reposShown = $derived(
    rq ? repoCounts.filter(([r]) => r.toLowerCase().includes(rq)) : app.layout.allRepos ? repoCounts : repoCounts.slice(0, repoLimit),
  );
  const closed = $derived(new Set(app.layout.railClosed));
  const toggleSec = (id: RailSection) => app.toggleRailSection(id);
  const lockTitle = "Token can see private repositories here";
</script>

{#snippet head(id: RailSection, label: string, extra?: import("svelte").Snippet)}
  <h2 data-sec={id} class:closed={closed.has(id)}>
    <button type="button" class="sech" aria-expanded={!closed.has(id)} onclick={() => toggleSec(id)}>{label}</button><span class="sp"
    ></span>
    {#if extra}{@render extra()}{/if}
    <button
      type="button"
      class="secbtn"
      aria-expanded={!closed.has(id)}
      title="{closed.has(id) ? 'Expand' : 'Collapse'} {label}"
      onclick={(e) => {
        e.stopPropagation();
        toggleSec(id);
      }}><Icon name="chevron-down" /></button
    >
  </h2>
{/snippet}

{#snippet plus()}
  <button
    type="button"
    class="ibtn"
    bind:this={popAnchor}
    title="Add users or organizations"
    aria-label="Add users or organizations"
    onclick={(e) => {
      e.stopPropagation();
      app.ownerPop = !app.ownerPop;
    }}><Icon name="plus" /></button
  >
{/snippet}

{#if viewIsFiltered(app.view)}
  <button type="button" class="more" onclick={() => app.resetFilters()}>Reset filters</button>
{/if}

{@render head("activity", "Activity")}
{#if !closed.has("activity")}
  <div class="rsec">
    {#each kindsShown as [k, l, i] (k)}
      <label class="frow"
        ><input
          type="checkbox"
          checked={app.kindSet.has(k)}
          onchange={(e) => app.toggleKind(k, (e.target as HTMLInputElement).checked)}
        /><Icon name={i} /><span class="lbl">{l}</span><span class="cnt" title="In the selected period">{count((e) => e.kind === k)}</span
        ></label
      >
    {/each}
    <button type="button" class="more" onclick={() => app.setAllKinds(!app.layout.allKinds)} aria-expanded={app.layout.allKinds}
      >{app.layout.allKinds ? "Show fewer" : `Show all ${RAIL_KINDS.length}`}</button
    >
  </div>
{/if}

{@render head("owners", "Owners", plus)}
{#if !closed.has("owners")}
  <div class="rsec">
    {#each app.settings.owners as o (o.login)}
      {@const meta = app.owners[o.login]}
      <label class="frow">
        <input
          type="checkbox"
          checked={app.ownersOn.has(o.login)}
          onchange={(e) => app.toggleOwnerOn(o.login, (e.target as HTMLInputElement).checked)}
        />
        {#if meta?.avatar}<img class="av" src={meta.avatar} alt="" />{:else}<Icon
            name={o.type === "org" ? "organization" : "person"}
          />{/if}
        <span class="lbl"
          >{o.login}{#if meta?.privateAccess}<Icon name="lock" cls="lk" size={12} />{/if}</span
        >
        <span class="cnt" title="In the selected period">{count((e) => ownerOf(e) === o.login)}</span>
      </label>
    {/each}
    {#if !app.settings.owners.length}<div class="none">Add a token in Settings to load your repositories.</div>{/if}
  </div>
{/if}
{#if app.ownerPop && popAnchor}<OwnerPopover anchor={popAnchor} onclose={() => (app.ownerPop = false)} />{/if}

{@render head("people", "People")}
{#if !closed.has("people")}
  <div class="rsec">
    <label class="frow"
      ><input type="checkbox" checked={app.view.hideMe} onchange={(e) => app.setHideMe((e.target as HTMLInputElement).checked)} /><span
        class="lbl">Hide my own activity</span
      ><span class="cnt" title="In the selected period">{count((e) => e.actor.toLowerCase() === app.me.toLowerCase())}</span></label
    >
    <label class="frow"
      ><input type="checkbox" checked={app.view.hideBots} onchange={(e) => app.setHideBots((e.target as HTMLInputElement).checked)} /><span
        class="lbl">Hide bots</span
      ><span class="cnt" title="In the selected period">{count((e) => e.bot)}</span></label
    >
  </div>
{/if}

{@render head("period", "Period")}
{#if !closed.has("period")}
  <div class="rsec">
    {#each PERIODS as [v, l] (v)}
      <label class="frow"
        ><input type="radio" name="period" value={v} checked={app.view.period === v} onchange={() => app.setPeriod(v)} /><span class="lbl"
          >{l}</span
        ></label
      >
    {/each}
  </div>
{/if}

{@render head("repositories", "Repositories")}
{#if !closed.has("repositories")}
  <div class="rsec">
    <label class="rsearch"
      ><Icon name="search" /><input
        id="rq"
        type="search"
        placeholder="Filter repositories"
        bind:value={app.rq}
        autocomplete="off"
        aria-label="Filter repositories"
      /></label
    >
    {#if rq && !reposShown.length}<div class="none">No repositories match</div>{/if}
    {#each reposShown as [r, c] (r)}
      <label class="frow" class:active={app.repoSet.has(r)} title={r}
        ><input
          type="checkbox"
          checked={app.repoSet.has(r)}
          onchange={(e) => app.toggleRepo(r, (e.target as HTMLInputElement).checked)}
        /><span class="lbl">{r.split("/")[1]}</span><span class="cnt" title="In the selected period">{c}</span></label
      >
    {/each}
    {#if !rq && repoCounts.length > repoLimit}
      <button type="button" class="more" onclick={() => app.setAllRepos(!app.layout.allRepos)} aria-expanded={app.layout.allRepos}
        >{app.layout.allRepos ? "Show fewer" : `Show all ${repoCounts.length}`}</button
      >
    {/if}
  </div>
{/if}

<style>
  :global(.rail) h2 .sech {
    font: inherit;
    color: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    padding: 0;
    cursor: pointer;
  }
  :global(.frow .lbl .ic.lk) {
    width: 12px;
    height: 12px;
    color: var(--text-2);
    margin-left: 4px;
  }
</style>
