<script lang="ts">
  import { onMount } from "svelte";
  import { registerSW } from "virtual:pwa-register";
  let offline = $state(!navigator.onLine);
  let ready = $state(false);
  let update = $state(false);
  let install = $state<(Event & { prompt(): Promise<void> }) | null>(null);
  let applyUpdate: ((reload?: boolean) => Promise<void>) | undefined;
  onMount(() => {
    const connection = () => {
      offline = !navigator.onLine;
    };
    const offerInstall = (event: Event) => {
      event.preventDefault();
      install = event as Event & { prompt(): Promise<void> };
    };
    const installed = () => {
      install = null;
    };
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    window.addEventListener("beforeinstallprompt", offerInstall);
    window.addEventListener("appinstalled", installed);
    applyUpdate = registerSW({
      onNeedRefresh() {
        update = true;
      },
      onOfflineReady() {
        ready = true;
      },
      onRegisterError(error) {
        console.error("Offline support could not be registered", error);
      },
    });
    return () => {
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      window.removeEventListener("beforeinstallprompt", offerInstall);
      window.removeEventListener("appinstalled", installed);
    };
  });
</script>

{#if offline || ready || update || install}
  <div class="pwa-notice" role="status">
    {#if offline}<span>Offline — showing saved activity.</span>{/if}
    {#if update}
      <span>An update is available.</span>
      <button class="btn" onclick={() => applyUpdate?.(true)}>Update now</button>
      <button
        class="btn"
        onclick={() => {
          update = false;
        }}>Later</button
      >
    {:else if ready && !offline}
      <span>Ready to use offline.</span>
      <button
        class="btn"
        onclick={() => {
          ready = false;
        }}>Dismiss</button
      >
    {/if}
    {#if install}<button
        class="btn"
        onclick={async () => {
          const event = install;
          install = null;
          await event?.prompt();
        }}>Install app</button
      >{/if}
  </div>
{/if}

<style>
  .pwa-notice {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 100;
    max-width: calc(100vw - 32px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--bg, Canvas);
    color: var(--text, CanvasText);
    border: 1px solid var(--border, GrayText);
    border-radius: 8px;
    box-shadow: 0 2px 12px #0003;
  }
</style>
