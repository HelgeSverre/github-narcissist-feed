<script lang="ts">
  let { rows = 6 }: { rows?: number } = $props();
</script>

<div class="card skel" aria-hidden="true">
  {#each Array.from({ length: rows }) as _, i (i)}
    <div class="row">
      <span class="sk c"></span><span class="sk c20"></span><span class="sk" style="width:{45 + ((i * 17) % 40)}%"></span><span
        class="sk"
        style="width:32px"
      ></span><span class="sk" style="width:36px"></span>
    </div>
  {/each}
</div>
