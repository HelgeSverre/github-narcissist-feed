<script lang="ts">
  // Three separate display views answer: what belongs on a desk display, and how should touch interrupt playback?
  // Prototype only: fixtures, no GitHub requests, no persisted settings. Share views with ?variant=spotlight|activity|repositories.
  import { onMount } from "svelte";
  import Icon from "../components/Icon.svelte";
  import { ACCENT_PRESETS, accentTokens } from "../lib/accent";
  import { activity, kindIcons, screens, type Screen, type DisplayEvent } from "./fixtures";
  import Spotlight from "./Spotlight.svelte";
  import Activity from "./Activity.svelte";
  import Repositories from "./Repositories.svelte";

  const requested = new URLSearchParams(location.search).get("variant");
  let screen = $state<Screen>(screens.find((item) => item.id === requested)?.id ?? "spotlight");
  let eventIndex = $state(0);
  let filter = $state("");
  let accent = $state("");
  let rotating = $state(false);
  let interval = $state(30);
  let playlist = $state<Screen[]>(screens.map((item) => item.id));
  let now = $state(Date.now());
  let screenSince = $state(Date.now());
  let lastTouch = $state(Date.now());
  let resumeAt = $state(0);
  let modalOpen = $state(false);
  let settings: HTMLDialogElement;
  let detail: HTMLDialogElement;
  let selected = $state<DisplayEvent | null>(null);
  const colors = $derived(accentTokens(accent).dark);
  const currentEvent = $derived(activity[eventIndex]);
  const paused = $derived(rotating && (modalOpen || now < resumeAt));
  const remaining = $derived(Math.max(0, Math.ceil(((paused ? resumeAt : screenSince + interval * 1000) - now) / 1000)));
  const faded = $derived(rotating && !paused && now - lastTouch > 6500);
  const clock = $derived(new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

  function interact() {
    lastTouch = Date.now();
    if (rotating) resumeAt = Date.now() + 30_000;
  }
  function navigate(next: Screen, manual = true) {
    screen = next;
    screenSince = Date.now();
    if (next !== "activity") filter = "";
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(null, "", url);
    if (manual) interact();
  }
  function cycle(delta: number, manual = true) {
    const choices = manual ? screens.map((item) => item.id) : playlist;
    const index = choices.indexOf(screen);
    const next = choices[(Math.max(0, index) + delta + choices.length) % choices.length];
    navigate(next, manual);
    if (!manual && next === "spotlight") eventIndex = (eventIndex + 1) % activity.length;
  }
  function toggleRotation() {
    rotating = !rotating;
    screenSince = Date.now();
    resumeAt = 0;
    lastTouch = Date.now();
  }
  function resume() {
    resumeAt = 0;
    screenSince = Date.now();
  }
  function openSettings() {
    interact();
    modalOpen = true;
    settings.showModal();
  }
  function openEvent(event: DisplayEvent) {
    interact();
    selected = event;
    modalOpen = true;
    detail.showModal();
  }
  function closeModal() {
    modalOpen = false;
    interact();
    screenSince = Date.now();
  }
  function togglePlaylist(id: Screen) {
    if (playlist.includes(id)) {
      if (playlist.length > 1) playlist = playlist.filter((item) => item !== id);
    } else playlist = screens.filter((item) => item.id === id || playlist.includes(item.id)).map((item) => item.id);
  }
  onMount(() => {
    const timer = setInterval(() => {
      now = Date.now();
      if (document.hidden || !rotating || modalOpen) {
        screenSince = now;
        return;
      }
      if (resumeAt > now) {
        screenSince = now;
        return;
      }
      if (now - screenSince >= interval * 1000) cycle(1, false);
    }, 250);
    const key = (event: KeyboardEvent) => {
      if (modalOpen || (event.target as HTMLElement).closest("input, select, textarea, [contenteditable]")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        cycle(event.key === "ArrowRight" ? 1 : -1);
      }
      if (event.key === "Escape") {
        rotating = false;
        lastTouch = Date.now();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", key);
    };
  });
</script>

<svelte:document onpointerdown={interact} />
<div
  class="display-shell"
  style:--accent={colors.accent}
  style:--accent-bg={colors.accentBg}
  style:--on-accent={colors.onAccent}
  style:--focus={colors.accent}
>
  <header class="display-header" class:quiet={faded}>
    <a class="display-brand" href="./index.html" aria-label="Return to the regular feed"
      ><img src="/icons/icon-48.png" alt="" width="32" height="32" /><span
        >Narcissist Feed<span class="brand-account">HelgeSverre · Public display</span></span
      ></a
    >
    <div class="display-clock"><time>{clock}</time><span>Sample data · not connected</span></div>
  </header>
  <main class="display-main">
    {#if screen === "spotlight"}
      <Spotlight
        event={currentEvent}
        index={eventIndex}
        total={activity.length}
        previous={() => {
          eventIndex = (eventIndex - 1 + activity.length) % activity.length;
        }}
        next={() => {
          eventIndex = (eventIndex + 1) % activity.length;
        }}
        open={() => openEvent(currentEvent)}
      />
    {:else if screen === "activity"}
      <Activity
        {filter}
        open={openEvent}
        clearFilter={() => {
          filter = "";
        }}
      />
    {:else}
      <Repositories
        browse={(repo) => {
          navigate("activity");
          filter = repo;
        }}
      />
    {/if}
  </main>
  <footer class="display-footer" class:quiet={faded}>
    <div class="playback-status">
      {#if rotating}<span class="playback-dot" class:held={paused}></span><span
          >{modalOpen ? "Paused · reading" : paused ? `Paused for touch · ${remaining}s` : `Next view in ${remaining}s`}</span
        >{#if paused && !modalOpen}<button onclick={resume}>Resume</button>{/if}
      {:else}<span class="playback-dot held"></span><span>Tap a view to explore</span>{/if}
    </div>
    <nav class="display-nav" aria-label="Display views">
      <button class="screen-arrow" aria-label="Previous view" onclick={() => cycle(-1)}><Icon name="arrow-left" size={20} /></button>
      {#each screens as item}<button
          aria-current={screen === item.id ? "page" : undefined}
          class:active={screen === item.id}
          onclick={() => navigate(item.id)}><Icon name={item.icon} size={19} /><span>{item.name}</span></button
        >{/each}
      <button class="screen-arrow" aria-label="Next view" onclick={() => cycle(1)}><Icon name="chevron-right" size={20} /></button>
    </nav>
    <div class="display-tools">
      <button
        class="touch-button play-toggle"
        aria-label={rotating ? "Pause screen rotation" : "Start screen rotation"}
        onclick={toggleRotation}
        ><Icon name={rotating ? "x" : "sync"} size={18} /><span>{rotating ? "Pause rotation" : "Auto rotate"}</span></button
      ><button class="touch-button settings-trigger" aria-label="Display settings" onclick={openSettings}
        ><Icon name="gear" size={22} /></button
      >
    </div>
  </footer>
  <div class="prototype-state">
    Interactive sketch · Sample data · Nothing saved <span
      >view={screen} · rotation={rotating ? "on" : "off"} · interval={interval}s · playlist={playlist.join(",")}{paused
        ? " · paused for interaction"
        : ""}</span
    >
  </div>
  {#if rotating}<progress
      class="rotation-progress"
      max={interval * 1000}
      value={paused ? 0 : now - screenSince}
      aria-label="Time until next view"
    ></progress>{/if}

  <dialog bind:this={settings} class="display-dialog settings-dialog" aria-label="Display settings" onclose={closeModal}>
    <div class="dialog-top">
      <h2>Make room for your feed.</h2>
      <button class="touch-button" aria-label="Close display settings" onclick={() => settings.close()}><Icon name="x" size={22} /></button>
    </div>
    <p class="dialog-intro">Display settings for this sketch. Try them out; nothing is saved.</p>
    <section>
      <h3>Move through the views</h3>
      <label class="setting-line"
        ><span>Rotate automatically<small>Pause while you touch, browse or read details.</small></span><input
          type="checkbox"
          checked={rotating}
          onchange={() => {
            toggleRotation();
          }}
        /></label
      ><label class="setting-line"
        ><span>Time on each view</span><select bind:value={interval} aria-label="Time on each view"
          ><option value={10}>10 seconds · quick preview</option><option value={30}>30 seconds</option><option value={60}>1 minute</option
          ></select
        ></label
      >
      <fieldset>
        <legend>Include in the rotation</legend>{#each screens as item}<label class="playlist-choice"
            ><input
              type="checkbox"
              checked={playlist.includes(item.id)}
              disabled={playlist.length === 1 && playlist.includes(item.id)}
              onchange={() => togglePlaylist(item.id)}
            /><span>{item.name}</span></label
          >{/each}
      </fieldset>
    </section>
    <section>
      <h3>A color that feels at home</h3>
      <div class="display-color-choices">
        {#each ACCENT_PRESETS.filter((item) => ["Blue", "Cyan", "Green", "Orange", "Purple"].includes(item.name)) as preset}<button
            aria-label={`${preset.name} accent`}
            aria-pressed={accent === preset.hex}
            style:--swatch={accentTokens(preset.hex).dark.accent}
            onclick={() => {
              accent = preset.hex;
            }}
            ><span
              >{#if accent === preset.hex}<Icon name="check" />{/if}</span
            >{preset.name}</button
          >{/each}
      </div>
    </section>
    <section class="display-notes">
      <h3>Designed for a shared screen</h3>
      <p>
        The connected version would default to public repositories, show the last successful refresh, and keep cached activity visible
        offline.
      </p>
      <p>Screen rotation is separate from fetching new activity. Changing views should never spend GitHub requests.</p>
    </section>
    <button class="dialog-done" onclick={() => settings.close()}>Back to the display</button>
  </dialog>
  <dialog bind:this={detail} class="display-dialog detail-dialog" aria-label="Activity details" onclose={closeModal}>
    {#if selected}<div class="dialog-top">
        <span class="detail-identity"
          ><span class="display-avatar small">{selected.initials}</span><span
            >@{selected.actor}<small>{selected.time} · Sample activity</small></span
          ></span
        ><button class="touch-button" aria-label="Close activity details" onclick={() => detail.close()}><Icon name="x" size={22} /></button
        >
      </div>
      <p class="detail-action"><Icon name={kindIcons[selected.kind]} size={22} />{selected.action} <strong>{selected.repo}</strong></p>
      <h2>{selected.title || `A new ${selected.kind} for your work.`}</h2>
      <p class="detail-body">{selected.detail}</p>
      <div class="detail-actions">
        <button
          class="touch-button"
          onclick={() => {
            const repo = selected!.repo;
            detail.close();
            navigate("activity");
            filter = repo;
          }}>More from this repository<Icon name="chevron-right" /></button
        ><button class="dialog-done" onclick={() => detail.close()}>Back</button>
      </div>
    {/if}
  </dialog>
</div>
