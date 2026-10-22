<script lang="ts">
  import { onMount } from "svelte";
  import { app, send } from "../lib/app.svelte";
  import Icon from "./Icon.svelte";

  let { anchor, onclose }: { anchor: HTMLElement; onclose: () => void } = $props();
  let q = $state("");
  let remote = $state<{ login: string; avatar: string; type: "user" | "org"; privateAccess: boolean }[]>([]);
  let searching = $state(false);
  let input = $state<HTMLInputElement | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const rect = $derived(anchor.getBoundingClientRect());
  const top = $derived(rect.bottom + 4 + window.scrollY);
  const left = $derived(Math.min(rect.left, window.innerWidth - 316));

  const selected = $derived(new Set(app.settings.owners.map((o) => o.login.toLowerCase())));
  const query = $derived(q.trim().toLowerCase());
  const local = $derived(app.people.filter((k) => !query || k.login.toLowerCase().includes(query)));
  const groups = $derived.by(() => {
    const g: Record<string, typeof local> = {};
    for (const k of local) (g[k.group] ??= []).push(k);
    return Object.entries(g);
  });
  const known = $derived(new Set([...app.people.map((p) => p.login.toLowerCase()), ...remote.map((r) => r.login.toLowerCase())]));
  const remoteShown = $derived(remote.filter((r) => !app.people.some((p) => p.login.toLowerCase() === r.login.toLowerCase())));
  const offerAdd = $derived(query.length > 0 && !known.has(query) && !searching);

  $effect(() => {
    const term = q.trim();
    clearTimeout(timer);
    if (term.length < 2 || !app.hasToken) {
      remote = [];
      searching = false;
      return;
    }
    searching = true;
    timer = setTimeout(async () => {
      try {
        const r = await send<typeof remote | { error: string }>({ type: "searchOwners", q: term });
        remote = Array.isArray(r) ? r : [];
      } catch {
        remote = [];
      } finally {
        searching = false;
      }
    }, 300);
  });

  async function pick(login: string, type: "user" | "org", on: boolean) {
    if (on) await app.addOwner(login, type);
    else await app.removeOwner(login);
  }

  onMount(() => {
    input?.focus();
    if (!app.people.length && app.hasToken) void send({ type: "loadPeople" });
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("#pop") && e.target !== anchor && !anchor.contains(e.target as Node)) onclose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onclose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      // Closing removes the focused search field or checkbox; send keyboard focus back to the button that opened the popover.
      const a = document.activeElement;
      if (!a || a === document.body || a.closest("#pop")) anchor.focus();
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  });
</script>

{#snippet row(login: string, avatar: string, type: "user" | "org", priv: boolean)}
  <label class="frow">
    <input
      type="checkbox"
      checked={selected.has(login.toLowerCase())}
      disabled={login.toLowerCase() === app.me.toLowerCase()}
      onchange={(e) => pick(login, type, (e.target as HTMLInputElement).checked)}
    />
    {#if avatar}<img class="av" src={avatar} alt="" />{:else}<span class="av init">{login.slice(0, 2).toUpperCase()}</span>{/if}
    <span class="lbl"
      >{login}{#if priv}<Icon name="lock" cls="lk" size={12} />{/if}</span
    >
    <span class="sub">{type === "org" ? "Organization" : "User"}</span>
  </label>
{/snippet}

<div class="pop" id="pop" style="top:{top}px;left:{left}px" role="dialog" aria-label="Add users or organizations">
  <div class="search">
    <Icon name="search" /><input
      bind:this={input}
      type="search"
      placeholder="Search users and organizations"
      bind:value={q}
      autocomplete="off"
      aria-label="Search users and organizations"
    />
  </div>
  <div class="list">
    {#each groups as [g, ks] (g)}
      <h3>{g}</h3>
      {#each ks.slice(0, 50) as k (k.login)}{@render row(k.login, k.avatar, k.type, k.privateAccess)}{/each}
      {#if ks.length > 50}<div class="frow sub">{ks.length - 50} more, keep typing</div>{/if}
    {/each}
    {#if remoteShown.length}
      <h3>GitHub</h3>
      {#each remoteShown as r (r.login)}{@render row(r.login, r.avatar, r.type, r.privateAccess)}{/each}
    {/if}
    {#if searching}<div class="frow sub">Searching GitHub…</div>{/if}
    {#if offerAdd}
      <h3>GitHub</h3>
      <label class="frow"
        ><input
          type="checkbox"
          onchange={(e) => {
            if ((e.target as HTMLInputElement).checked) pick(q.trim(), "user", true);
          }}
        /><Icon name="plus" /><span class="lbl">Add "{q.trim()}"</span></label
      >
    {/if}
    {#if !local.length && !remoteShown.length && !offerAdd && !searching}<div class="frow sub">
        {app.hasToken ? "No matches" : "Add a token to search"}
      </div>{/if}
  </div>
  <div class="foot"><Icon name="lock" size={12} /> Your token can see private repositories here</div>
</div>
