<script lang="ts">
  import { app, send } from "../lib/app.svelte";
  import { WINDOWS } from "../lib/feed";
  import { daysUntil, relative } from "../lib/format";
  import type { Settings, Status } from "../lib/types";
  import Icon from "./Icon.svelte";

  let tokenDraft = $state(app.token);
  let showTok = $state(false);
  let saving = $state(false);
  let addLogin = $state("");
  let addErr = $state("");

  const sample = new Date(2026, 9, 21, 20, 5);
  const exp = $derived(daysUntil(app.status.tokenExpiresAt, app.now));
  const s = $derived(app.settings);
  const st = $derived(app.status);
  const privateOwners = $derived(
    Object.values(app.owners)
      .filter((o) => o.privateAccess)
      .map((o) => o.login),
  );

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    void app.save({ [key]: value } as Partial<Settings>);
  }
  const sel = (e: Event) => (e.target as HTMLSelectElement).value;
  const chk = (e: Event) => (e.target as HTMLInputElement).checked;

  async function saveToken() {
    if (tokenDraft.trim() === app.token) return;
    saving = true;
    try {
      const res = await send<Status>({ type: "validateToken", token: tokenDraft.trim() });
      if (res.tokenOk) await app.saveToken(tokenDraft.trim());
    } finally {
      saving = false;
    }
  }
  async function addOwner() {
    const login = addLogin.trim();
    addErr = "";
    if (!login) return;
    const r = await send<{ error?: string; type?: "user" | "org" }>({ type: "resolveOwner", login });
    if (r?.error) {
      addErr = r.error;
      return;
    }
    await app.addOwner(login, r.type ?? "user");
    addLogin = "";
  }
</script>

<div class="settings">
  <h2 id="s-github">GitHub</h2>
  <div class="card">
    <div class="srow">
      <div class="l">
        Username
        <div class="sub">Filled in from the token. Your own repositories are always included.</div>
      </div>
      <input type="text" id="s-user" value={s.username} readonly aria-label="Username" />
    </div>
    <div class="srow">
      <div class="l">
        Owners
        <div class="sub">Users and organizations whose repositories appear in the feed. Also editable from the rail.</div>
        {#if addErr}<div class="err">{addErr}</div>{/if}
      </div>
      <div class="chips">
        {#each s.owners as o (o.login)}
          <span class="chip"
            >{o.login}{#if app.owners[o.login]?.privateAccess}<Icon name="lock" size={12} />{/if}
            {#if o.login.toLowerCase() !== app.me.toLowerCase()}<button
                type="button"
                class="ibtn"
                style="width:20px;height:20px"
                title="Remove {o.login}"
                aria-label="Remove {o.login}"
                onclick={() => app.removeOwner(o.login)}><Icon name="x" size={12} /></button
              >{/if}
          </span>
        {/each}
        <input
          type="text"
          placeholder="user or org"
          bind:value={addLogin}
          onkeydown={(e) => {
            if (e.key === "Enter") addOwner();
          }}
          style="min-width:140px"
          aria-label="Add owner"
        />
        <button type="button" class="btn" onclick={addOwner} disabled={!app.hasToken}>Add</button>
      </div>
    </div>
    <div class="srow block">
      <div class="l">
        Personal access token
        <div class="sub">
          Use a fine-grained, read-only token. Repository access: All repositories. Repository permissions: Metadata, Issues and Pull
          requests (read-only), and Contents. GitHub only lets fine-grained tokens list stargazers with Contents set to Read and write; with
          Read-only everything except stars loads.
        </div>
        <div class="sub">
          The token stays in this browser profile's extension storage and is only sent to api.github.com. It is not synced, so paste it once
          on each computer.
        </div>
        <a class="xlink" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener"
          >Create a fine-grained token on GitHub<Icon name="link-external" size={12} /></a
        >
      </div>
      <div class="tokfield">
        <input
          type={showTok ? "text" : "password"}
          id="s-token"
          bind:value={tokenDraft}
          onblur={saveToken}
          onkeydown={(e) => {
            if (e.key === "Enter") saveToken();
          }}
          spellcheck="false"
          autocomplete="off"
          aria-label="Personal access token"
          placeholder="github_pat_…"
        />
        <button
          type="button"
          class="reveal"
          title={showTok ? "Hide token" : "Show token"}
          aria-label={showTok ? "Hide token" : "Show token"}
          aria-pressed={showTok}
          onclick={() => (showTok = !showTok)}><Icon name={showTok ? "eye-closed" : "eye"} /></button
        >
      </div>
      <ul class="kv">
        <li>
          <span class="k">Status</span><span class="v">
            {#if saving}<Icon name="sync" size={14} /> Checking…
            {:else if !app.hasToken}<Icon name="x-circle" cls="k-neutral" size={14} /> No token
            {:else if st.tokenOk}<Icon name="check-circle" cls="k-open" size={14} /> Valid as {st.viewer}{#if exp !== null}, expires in {exp}
                days{/if}
            {:else}<Icon name="x-circle" cls="k-closed" size={14} /> {st.tokenError ?? "Not validated"}{/if}
          </span>
        </li>
        {#if app.hasToken && st.tokenOk}
          <li>
            <span class="k">Stars</span><span class="v">
              {#if st.starsAccess === false}<Icon name="x-circle" cls="k-closed" size={14} /> Token cannot list stargazers. GitHub requires Repository
                permissions → Contents → Read and write for that.
              {:else}<Icon name="check-circle" cls="k-open" size={14} /> Readable{/if}
            </span>
          </li>
        {/if}
        <li>
          <span class="k">Rate limit</span><span class="v"
            ><Icon name="sync" size={14} />
            {st.rateRemaining?.toLocaleString() ?? "–"} of {st.rateLimit?.toLocaleString() ?? "5,000"} requests left this hour</span
          >
        </li>
        <li>
          <span class="k">Last refresh</span><span class="v"
            >{relative(st.lastQuickAt, app.now)} · full sweep {relative(st.lastFullAt, app.now)}{#if st.lastError}
              · <span class="err">{st.lastError}</span>{/if}</span
          >
        </li>
        <li>
          <span class="k">Private access</span><span class="v wrap"
            >{#each privateOwners as o (o)}<span class="chip"><Icon name="lock" size={12} />{o}</span>{:else}<span class="note"
                >none detected</span
              >{/each}</span
          >
        </li>
      </ul>
    </div>
    <div class="srow">
      <div class="l">
        Include private repositories
        <div class="sub">Rows from private repositories show a lock.</div>
      </div>
      <input
        type="checkbox"
        class="toggle"
        checked={s.includePrivate}
        onchange={(e) => set("includePrivate", chk(e))}
        aria-label="Include private repositories"
      />
    </div>
  </div>

  <h2 id="s-feed">Feed</h2>
  <div class="card">
    <div class="srow">
      <div class="l">
        Refresh
        <div class="sub">
          The 40 most recently pushed repositories per owner every interval; a full sweep of all repositories every hour.
        </div>
      </div>
      <select
        class="sel"
        value={String(s.refreshMinutes)}
        onchange={(e) => set("refreshMinutes", Number(sel(e)) as Settings["refreshMinutes"])}
        aria-label="Refresh interval"
        ><option value="5">Every 5 minutes</option><option value="10">Every 10 minutes</option><option value="30">Every 30 minutes</option
        ><option value="0">Only hourly</option></select
      >
    </div>
    <div class="srow">
      <div class="l">
        Show unstars and deleted forks
        <div class="sub">GitHub does not report these. The extension keeps its own ledger and shows a dim row when someone disappears.</div>
      </div>
      <input
        type="checkbox"
        class="toggle"
        checked={s.showUnstars}
        onchange={(e) => set("showUnstars", chk(e))}
        aria-label="Show unstars"
      />
    </div>
    <div class="srow">
      <div class="l">
        Trends column
        <div class="sub">
          Charts of stars, forks, issues and pull requests beside the feed. They follow the feed's period, grouping and filters. Panels can
          be reordered and collapsed.
        </div>
      </div>
      <input type="checkbox" class="toggle" checked={s.trends} onchange={(e) => set("trends", chk(e))} aria-label="Trends column" />
    </div>
  </div>

  <h2 id="s-stacking">Stacking</h2>
  <div class="card">
    <div class="srow">
      <div class="l">
        Stack similar activity
        <div class="sub">Fold repeated actions by the same person into one expandable row.</div>
      </div>
      <input type="checkbox" class="toggle" checked={s.stack} onchange={(e) => set("stack", chk(e))} aria-label="Stack similar activity" />
    </div>
    <div class="srow indent">
      <div class="l">
        Scope
        <div class="sub">
          Repository: same action by the same person in the same repository. Organization: also folds across repositories of one owner.
          Activity type: everything of one type inside a day, week or month group, regardless of who did it.
        </div>
      </div>
      <select
        class="sel"
        value={s.stackScope}
        onchange={(e) => set("stackScope", sel(e) as Settings["stackScope"])}
        aria-label="Stacking scope"
        ><option value="repo">Repository</option><option value="org">Organization</option><option value="type">Activity type</option
        ></select
      >
    </div>
    <div class="srow indent">
      <div class="l">Same repository within</div>
      <select
        class="sel"
        value={String(s.stackRepoWindow)}
        onchange={(e) => set("stackRepoWindow", Number(sel(e)))}
        aria-label="Repository window"
        >{#each WINDOWS as [v, l] (v)}<option value={String(v)}>{l}</option>{/each}</select
      >
    </div>
    <div class="srow indent">
      <div class="l">
        Same organization within
        <div class="sub">Only used with Organization scope.</div>
      </div>
      <select
        class="sel"
        value={String(s.stackOrgWindow)}
        onchange={(e) => set("stackOrgWindow", Number(sel(e)))}
        aria-label="Organization window"
        >{#each WINDOWS as [v, l] (v)}<option value={String(v)}>{l}</option>{/each}</select
      >
    </div>
  </div>

  <h2 id="s-datetime">Date and time</h2>
  <div class="card">
    <div class="srow">
      <div class="l">Date format</div>
      <select
        class="sel"
        value={s.dateFormat}
        onchange={(e) => set("dateFormat", sel(e) as Settings["dateFormat"])}
        aria-label="Date format"
        ><option value="system">System ({sample.toLocaleDateString()})</option><option value="iso">2026-10-21</option><option value="dmy"
          >21 Oct 2026</option
        ><option value="mdy">Oct 21, 2026</option></select
      >
    </div>
    <div class="srow">
      <div class="l">Time format</div>
      <select
        class="sel"
        value={s.timeFormat}
        onchange={(e) => set("timeFormat", sel(e) as Settings["timeFormat"])}
        aria-label="Time format"><option value="24">20:05</option><option value="12">8:05 PM</option></select
      >
    </div>
    <div class="srow">
      <div class="l">
        Week starts on
        <div class="sub">Used by weekly grouping.</div>
      </div>
      <select
        class="sel"
        value={String(s.weekStart)}
        onchange={(e) => set("weekStart", Number(sel(e)) as 0 | 1)}
        aria-label="Week starts on"><option value="1">Monday</option><option value="0">Sunday</option></select
      >
    </div>
  </div>

  <h2 id="s-appearance">Appearance</h2>
  <div class="card">
    <div class="srow">
      <div class="l">Theme</div>
      <select class="sel" value={s.theme} onchange={(e) => set("theme", sel(e) as Settings["theme"])} aria-label="Theme"
        ><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select
      >
    </div>
    <div class="srow">
      <div class="l">Density</div>
      <select class="sel" value={s.density} onchange={(e) => set("density", sel(e) as Settings["density"])} aria-label="Density"
        ><option value="default">Default</option><option value="compact">Compact</option></select
      >
    </div>
  </div>

  <h2 id="s-sync">Sync</h2>
  <div class="card">
    <div class="srow">
      <div class="l">
        Settings, filters and layout follow your Chrome profile when Chrome sync is on. The token and cached activity stay on this computer.
      </div>
      <div class="chips">
        <button type="button" class="btn" onclick={() => app.resetFilters()}>Reset filters</button><button
          type="button"
          class="btn"
          onclick={() => app.resetLayout()}>Reset layout</button
        >
      </div>
    </div>
  </div>
</div>
