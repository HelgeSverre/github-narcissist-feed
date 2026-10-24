<script lang="ts">
  import { tick } from "svelte";
  import { app, send } from "../lib/app.svelte";
  import { ACCENT_PRESETS, accentTokens } from "../lib/accent";
  import { flushPrefs } from "../lib/prefs";
  import { publicOwner } from "../lib/public-github";
  import { setLocal } from "../lib/storage";
  import type { OwnerMeta, Settings, Status } from "../lib/types";
  import { isWebsite } from "../lib/platform";
  import Icon from "./Icon.svelte";

  let step = $state(0);
  let username = $state(app.settings.username);
  let access = $state<"public" | "authenticated">(app.hasToken ? "authenticated" : "public");
  let token = $state(app.token);
  let showToken = $state(false);
  let accent = $state(app.settings.accent);
  let style = $state("focused");
  let refreshMinutes = $state<Settings["refreshMinutes"]>(30);
  let busy = $state(false);
  let error = $state("");
  let account = $state<OwnerMeta | null>(null);
  let heading: HTMLHeadingElement;
  const labels = ["Account", "Access", "Color", "Feed", "Updates"];
  const titles = [
    "Your GitHub, about you.",
    "How would you like to connect?",
    "Make it feel like yours.",
    "What would you like to see?",
    "How often should we check?",
  ];
  const descriptions = [
    "See stars, forks and conversations on your repositories. Let’s start with your GitHub username.",
    "Start with public activity, or connect a token for private repositories and more frequent updates.",
    "Pick an accent for links, selected filters and buttons. You can change it any time.",
    "We’ll set up your filters and layout to match. All the details are in Settings later.",
    isWebsite
      ? "We’ll look for new activity while this app is open. You can always refresh by hand."
      : "We’ll look for new activity in the background. You can always refresh by hand.",
  ];
  const colors = $derived(app.dark ? accentTokens(accent).dark : accentTokens(accent).light);

  async function go(next: number) {
    step = next;
    error = "";
    await tick();
    heading?.focus();
  }
  async function advance() {
    if (busy) return;
    error = "";
    busy = true;
    try {
      if (step === 0) {
        username = username.trim().replace(/^@/, "");
        if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username) || username.includes("--"))
          throw new Error("Enter a GitHub username, such as helgesverre. Use the name, not a profile link.");
        account = await publicOwner(username);
        username = account.login;
      }
      if (step === 1 && access === "authenticated") {
        if (!token.trim()) throw new Error("Paste a personal access token, or choose Public only to continue without one.");
        const status = await send<Status & { error?: string }>({ type: "validateToken", token: token.trim() });
        if (!status?.tokenOk)
          throw new Error(status?.tokenError || status?.error || "We couldn’t verify that token. Check it and try again.");
      }
      if (step < 4) await go(step + 1);
      else {
        if (!account) throw new Error("Go back to Account and confirm your username.");
        await setLocal({ setupInProgress: Date.now() + 60_000 });
        app.save({
          username: account.login,
          owners: [{ login: account.login, type: account.type, on: true }],
          includePrivate: access === "authenticated",
          refreshMinutes,
          accent,
          stack: style === "focused",
          stackScope: "org",
          trends: style === "everything",
          showUnstars: false,
        });
        app.setHideMe(style === "focused");
        app.setHideBots(style === "focused");
        await flushPrefs();
        await app.saveToken(access === "authenticated" ? token.trim() : "");
        // Changing access modes discards private caches and stale account status before entering the feed.
        await setLocal({
          events: {},
          ledger: {},
          owners: {
            [account.login]: {
              ...account,
              privateAccess: access === "authenticated" && app.status.viewer?.toLowerCase() === account.login.toLowerCase(),
            },
          },
          status: {
            ...(access === "authenticated" ? app.status : {}),
            refreshing: null,
            refreshingSince: undefined,
            lastQuickAt: undefined,
            lastFullAt: undefined,
          },
          publicCursor: 0,
        });
        await app.completeOnboarding();
        await setLocal({ setupInProgress: 0 });
        void send({ type: "refresh", mode: "full" });
        await tick();
        document.getElementById("q")?.focus();
      }
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      if (step === 4) await setLocal({ setupInProgress: 0 });
      busy = false;
    }
  }
</script>

<main
  class="setup"
  style:--accent={colors.accent}
  style:--accent-bg={colors.accentBg}
  style:--on-accent={colors.onAccent}
  style:--focus={colors.accent}
>
  <div class="setup-shell">
    <div class="brand">
      <img src={`${import.meta.env.BASE_URL}icons/icon-48.png`} width="32" height="32" alt="" /><span>Narcissist Feed</span>
    </div>
    <nav aria-label="Setup progress">
      <ol>
        {#each labels as label, index}
          <li aria-current={step === index ? "step" : undefined} class:current={step === index} class:done={step > index}>
            <span class="step-mark"
              >{#if step > index}<Icon name="check" size={12} />{:else}{index + 1}{/if}</span
            ><span class="step-label">{label}</span>
          </li>
        {/each}
      </ol>
    </nav>
    <section class="setup-body" aria-labelledby="setup-title" aria-busy={busy}>
      <p class="step-count">Step {step + 1} of 5</p>
      <h1 id="setup-title" bind:this={heading} tabindex="-1">{titles[step]}</h1>
      <p class="intro">{descriptions[step]}</p>
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void advance();
        }}
        novalidate
      >
        <div class="question">
          {#if step === 0}
            <label class="field-label" for="setup-username">GitHub username</label>
            <div class="username-field">
              <span aria-hidden="true">github.com/</span><input
                id="setup-username"
                name="username"
                autocomplete="username"
                spellcheck="false"
                autocapitalize="none"
                placeholder="helgesverre"
                bind:value={username}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "setup-error" : "username-help"}
                required
                oninput={() => {
                  error = "";
                  account = null;
                }}
              />
            </div>
            <p class="help" id="username-help">Your personal account or an organization. No sign-up needed.</p>
          {:else if step === 1}
            <fieldset>
              <legend class="sr-only">Data access</legend>
              <label class="choice" class:selected={access === "public"}
                ><input
                  type="radio"
                  name="access"
                  value="public"
                  bind:group={access}
                  onchange={() => {
                    refreshMinutes = 30;
                    error = "";
                  }}
                /><span
                  ><strong>Public only <small>No token needed</small></strong><span
                    >Recent activity on public repositories. A simple way to get started.</span
                  ></span
                ></label
              >
              <label class="choice" class:selected={access === "authenticated"}
                ><input
                  type="radio"
                  name="access"
                  value="authenticated"
                  bind:group={access}
                  onchange={() => {
                    refreshMinutes = 10;
                    error = "";
                  }}
                /><span
                  ><strong>Connect with a token</strong><span
                    >Public and accessible private repositories, more history and a higher request limit.</span
                  ></span
                ></label
              >
            </fieldset>
            {#if access === "authenticated"}
              <div class="token-field">
                <label class="field-label" for="setup-token">GitHub personal access token</label>
                <div class="token-input">
                  <input
                    id="setup-token"
                    name="token"
                    type={showToken ? "text" : "password"}
                    bind:value={token}
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="github_pat_…"
                    aria-invalid={error ? true : undefined}
                    aria-describedby="token-help"
                    required
                    oninput={() => {
                      error = "";
                    }}
                  /><button
                    type="button"
                    class="reveal-token"
                    aria-label={showToken ? "Hide token" : "Show token"}
                    aria-pressed={showToken}
                    onclick={() => {
                      showToken = !showToken;
                    }}><Icon name={showToken ? "eye-closed" : "eye"} /></button
                  >
                </div>
                <p class="help" id="token-help">
                  Stored only in this browser and sent only to GitHub. Use read-only Metadata, Issues and Pull requests permissions. Stars
                  also need Contents: Read and write; this app never writes to GitHub.
                </p>
                <a
                  class="token-link"
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noopener noreferrer">Create a token on GitHub <Icon name="link-external" size={12} /></a
                >
              </div>
            {:else}<p class="help">
                GitHub’s public request limit is shared by your connection. We’ll check repositories in batches; public activity may take a
                little time to appear.
              </p>{/if}
          {:else if step === 2}
            <fieldset class="swatches">
              <legend class="field-label">Accent color</legend>
              {#each ACCENT_PRESETS as preset}
                {@const swatch = app.dark ? accentTokens(preset.hex).dark : accentTokens(preset.hex).light}
                <label class="swatch" class:chosen={accent === preset.hex} title={preset.name}
                  ><input type="radio" name="accent" value={preset.hex} bind:group={accent} aria-label={preset.name} /><span
                    class="color-dot"
                    style:background={swatch.accent}
                    style:color={swatch.onAccent}
                    >{#if accent === preset.hex}<Icon name="check" size={16} />{/if}</span
                  ><span>{preset.name}</span></label
                >
              {/each}
            </fieldset>
            <div class="feed-preview" aria-label="Sample feed preview">
              <span class="preview-label">A preview of your feed</span>
              <div>
                <Icon name="star" />
                <p><strong>Someone starred your repository</strong><span>A little recognition for your work.</span></p>
                <span class="preview-link">Your repository</span>
              </div>
              <div>
                <Icon name="comment" />
                <p><strong>A new conversation</strong><span>Keep up with what people are saying.</span></p>
              </div>
            </div>
          {:else if step === 3}
            <fieldset>
              <legend class="sr-only">Feed style</legend>
              <label class="choice" class:selected={style === "focused"}
                ><input type="radio" name="style" value="focused" bind:group={style} /><span
                  ><strong>Keep it focused <small>Recommended</small></strong><span
                    >What other people are doing. Hide bots and your own activity, group repeated actions, and keep charts tucked away.</span
                  ></span
                ></label
              >
              <label class="choice" class:selected={style === "everything"}
                ><input type="radio" name="style" value="everything" bind:group={style} /><span
                  ><strong>Show me everything</strong><span
                    >Include your activity and bots, show each action separately, and add trend charts alongside the feed.</span
                  ></span
                ></label
              >
            </fieldset>
          {:else}
            <fieldset>
              <legend class="sr-only">Refresh frequency</legend>
              {#if access === "authenticated"}<label class="choice" class:selected={refreshMinutes === 10}
                  ><input type="radio" name="refresh" value={10} bind:group={refreshMinutes} /><span
                    ><strong>Every 10 minutes</strong><span>Stay up to date throughout the day.</span></span
                  ></label
                >{/if}
              <label class="choice" class:selected={refreshMinutes === 30}
                ><input type="radio" name="refresh" value={30} bind:group={refreshMinutes} /><span
                  ><strong>Every 30 minutes</strong><span
                    >{access === "public"
                      ? "A gentler pace for GitHub’s public request limit."
                      : "Check in periodically with fewer requests."}</span
                  ></span
                ></label
              >
              <label class="choice" class:selected={refreshMinutes === 0}
                ><input type="radio" name="refresh" value={0} bind:group={refreshMinutes} /><span
                  ><strong>Only when I ask</strong><span>Use the Refresh button whenever you want an update.</span></span
                ></label
              >
            </fieldset>
            <p class="help">Ready for @{username}. You can adjust your feed, color and update frequency in Settings.</p>
          {/if}
        </div>
        {#if error}<p class="setup-error" id="setup-error" role="alert"><Icon name="x-circle" />{error}</p>{/if}
        <footer>
          {#if step > 0}<button type="button" class="back" disabled={busy} onclick={() => go(step - 1)}
              ><Icon name="arrow-left" />Back</button
            >{:else}<span class="footer-note">About a minute. All yours.</span>{/if}
          <button type="submit" class="next" disabled={busy}
            >{busy
              ? step === 4
                ? "Saving your choices…"
                : "Checking…"
              : step === 4
                ? "Open my dashboard"
                : "Continue"}{#if !busy && step < 4}<Icon name="chevron-right" />{/if}</button
          >
        </footer>
      </form>
    </section>
    <p class="privacy">Your data stays in your browser. No account with us. No tracking.</p>
  </div>
</main>

<style>
  .setup {
    width: 100%;
    min-height: 100svh;
    display: grid;
    place-items: center;
    padding: 40px 24px;
  }
  .setup-shell {
    width: min(100%, 620px);
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 32px;
  }
  ol {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    list-style: none;
    margin: 0 0 24px;
    padding: 0 8px;
  }
  li {
    display: flex;
    gap: 7px;
    align-items: center;
    color: var(--text-2);
    font-size: 12px;
  }
  .step-mark {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--border);
    border-radius: 50%;
    font-variant-numeric: tabular-nums;
  }
  .current {
    color: var(--accent);
    font-weight: 600;
  }
  .current .step-mark,
  .done .step-mark {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .setup-body {
    padding: 32px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
  }
  .step-count {
    font-size: 12px;
    color: var(--text-2);
    margin: 0 0 12px;
  }
  h1 {
    margin: 0 0 12px;
    font-size: clamp(24px, 4vw, 30px);
    line-height: 1.2;
    font-weight: 600;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }
  h1:focus {
    outline: none;
  }
  .intro {
    color: var(--text-2);
    font-size: 15px;
    line-height: 1.6;
    margin: 0 0 28px;
  }
  .question {
    min-height: 172px;
  }
  .field-label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  .username-field,
  .token-input {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .username-field:focus-within,
  .token-input:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .username-field > span {
    color: var(--text-2);
    padding-left: 14px;
    font-size: 16px;
  }
  .username-field input,
  .token-input input {
    width: 100%;
    min-width: 0;
    font: inherit;
    font-size: 16px;
    background: transparent;
    color: var(--text);
    border: 0;
    padding: 14px 10px;
    outline: none;
    caret-color: var(--accent);
  }
  input::placeholder {
    color: var(--text-2);
    opacity: 1;
  }
  .help {
    color: var(--text-2);
    margin: 12px 0 0;
    font-size: 13px;
    line-height: 1.6;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  .choice {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
  }
  .choice + .choice {
    margin-top: 12px;
  }
  .choice:hover {
    background: var(--hover);
  }
  .choice.selected {
    border-color: var(--accent);
    background: var(--accent-bg);
  }
  .choice input {
    flex: none;
    margin: 3px 0 0;
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .choice > span {
    flex: 1;
  }
  .choice strong {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
  }
  .choice strong + span {
    display: block;
    color: var(--text-2);
    font-size: 13px;
    line-height: 1.6;
    margin-top: 4px;
  }
  small {
    color: var(--accent);
    font-size: 11px;
    font-weight: 500;
  }
  .token-field {
    margin-top: 24px;
  }
  .reveal-token {
    display: grid;
    place-items: center;
    align-self: stretch;
    width: 48px;
    color: var(--text-2);
  }
  .token-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 12px;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 8px;
  }
  .swatches legend {
    margin-bottom: 16px;
  }
  .swatch {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 5px;
    min-width: 48px;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-2);
  }
  .swatch input,
  .sr-only {
    position: absolute;
    clip-path: inset(50%);
    width: 1px;
    height: 1px;
    overflow: hidden;
    white-space: nowrap;
  }
  .color-dot {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
  }
  .swatch.chosen .color-dot {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .swatch:has(input:focus-visible) {
    outline: 2px solid var(--focus);
    border-radius: 6px;
  }
  .feed-preview {
    margin-top: 28px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .preview-label {
    display: block;
    color: var(--text-2);
    font-size: 12px;
    margin-bottom: 12px;
  }
  .feed-preview > div {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
  }
  .feed-preview :global(.ic) {
    color: var(--accent);
  }
  .feed-preview p {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
  }
  .feed-preview p strong {
    font-weight: 500;
  }
  .feed-preview p span {
    display: block;
    color: var(--text-2);
  }
  .preview-link {
    color: var(--accent);
    font-size: 12px;
    margin-left: auto;
  }
  .setup-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    line-height: 1.5;
    margin: 20px 0 0;
    color: var(--c-closed);
  }
  .setup-error :global(.ic) {
    margin-top: 2px;
  }
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    border-top: 1px solid var(--border);
    margin-top: 28px;
    padding-top: 24px;
  }
  footer button {
    min-height: 44px;
    display: inline-flex;
    gap: 8px;
    align-items: center;
    justify-content: center;
    padding: 0 18px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
  }
  .next {
    background: var(--accent);
    color: var(--on-accent);
    margin-left: auto;
  }
  .next:hover {
    filter: brightness(0.94);
  }
  .back {
    color: var(--text-2);
    padding-left: 0;
  }
  button:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .footer-note {
    font-size: 12px;
    color: var(--text-2);
  }
  .privacy {
    text-align: center;
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.6;
    margin: 20px 0 0;
  }
  @media (max-width: 540px) {
    .setup {
      padding: 24px 16px;
    }
    .setup-body {
      padding: 24px 20px;
    }
    .brand {
      margin-bottom: 24px;
    }
    ol {
      padding: 0;
    }
    li {
      flex-direction: column;
      gap: 6px;
    }
    .step-label {
      font-size: 11px;
    }
    .footer-note,
    .preview-link {
      display: none;
    }
    footer button {
      min-height: 48px;
    }
    .question {
      min-height: 150px;
    }
  }
</style>
