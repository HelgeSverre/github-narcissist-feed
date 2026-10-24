<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { repositories } from "./fixtures";
  let { browse }: { browse: (repo: string) => void } = $props();
</script>

<section class="repository-screen screen-content" aria-labelledby="repositories-title">
  <div class="screen-heading">
    <div>
      <h1 id="repositories-title">Your work is finding people.</h1>
      <p>Where the activity is, across your repositories.</p>
    </div>
    <span class="quiet-label">Last 7 days · Sample data</span>
  </div>
  <div class="repository-columns">
    <span>Repository</span><span>Stars</span><span>Forks</span><span>Conversations</span><span>This week</span>
  </div>
  <div class="repository-list">
    {#each repositories as repo}
      <button class="repository-row" onclick={() => browse(repo.name)} aria-label={`Browse activity for ${repo.name}`}>
        <span class="repository-name"><strong>{repo.name}</strong><span>{repo.description}</span></span>
        <span class="repo-number"><Icon name="star" />{repo.stars}<small>stars</small></span><span class="repo-number"
          ><Icon name="repo-forked" />{repo.forks}<small>forks</small></span
        ><span class="repo-number"><Icon name="comment" />{repo.conversations}<small>conversations</small></span>
        <span class="repository-bars" aria-label={`${repo.name}, seven-day sample activity`}
          >{#each repo.trend as count}<span style:height={`${8 + count * 5}px`}></span>{/each}</span
        >
      </button>
    {/each}
  </div>
  <p class="repository-hint">
    Tap a repository to browse its activity. Public mode would show observed events, not complete GitHub totals.
  </p>
</section>
