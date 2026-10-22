<script lang="ts">
  import { onMount } from "svelte";

  const TOC = [
    ["s-github", "GitHub"],
    ["s-feed", "Feed"],
    ["s-stacking", "Stacking"],
    ["s-datetime", "Date and time"],
    ["s-appearance", "Appearance"],
    ["s-sync", "Sync"],
  ] as const;
  let cur = $state<string>(TOC[0][0]);
  let lock = 0;

  function spy() {
    if (Date.now() < lock) return;
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let c: string = TOC[0][0];
    if (atBottom) c = TOC[TOC.length - 1][0];
    else
      for (const [id] of TOC) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 96) c = id;
      }
    cur = c;
  }
  function go(id: string) {
    lock = Date.now() + 900;
    cur = id;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  onMount(() => {
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        spy();
      });
    };
    window.addEventListener("scroll", on, { passive: true });
    spy();
    return () => window.removeEventListener("scroll", on);
  });
</script>

<nav class="toc" aria-label="Settings sections">
  <div class="toch">On this page</div>
  {#each TOC as [id, l] (id)}
    <button type="button" class="tocl" class:on={cur === id} aria-current={cur === id ? "true" : undefined} onclick={() => go(id)}
      >{l}</button
    >
  {/each}
</nav>
