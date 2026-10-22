<script lang="ts">
  let { login, src }: { login: string; src: string } = $props();
  let failed = $state(false);
</script>

<span class="av">
  {#if src && !failed}<img {src} alt="" loading="lazy" onerror={() => (failed = true)} />{:else}{login.slice(0, 1).toUpperCase()}{/if}
</span>
