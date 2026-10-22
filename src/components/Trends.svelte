<script lang="ts">
  import { tick as flush } from "svelte";
  import { app } from "../lib/app.svelte";
  import { TREND_KINDS, type TrendKind } from "../lib/prefs";
  import { bucketList, filterEvents, floorToUnit, periodName, unitFor } from "../lib/feed";
  import { fmtDate, fmtTime } from "../lib/format";
  import Icon from "./Icon.svelte";

  const TKINDS: Record<TrendKind, [string, string, string]> = {
    star: ["Stars", "star", "--c-star"],
    fork: ["Forks", "repo-forked", "--c-fork"],
    issue: ["Issues", "issue-opened", "--c-open"],
    pr: ["Pull requests", "git-pull-request", "--c-merged"],
  };

  let width = $state(380);
  let dragK = $state<TrendKind | null>(null);
  let overK = $state<TrendKind | null>(null);

  const order = $derived(app.layout.trendOrder);
  const closed = $derived(new Set(app.layout.trendClosed));
  const unit = $derived(unitFor(app.view.period, app.view.group));
  const evs = $derived(
    filterEvents(
      app.events,
      {
        kinds: new Set(TREND_KINDS),
        owners: app.ownersOn,
        hideMe: app.view.hideMe,
        hideBots: app.view.hideBots,
        period: app.view.period,
        repos: app.repoSet,
        q: app.q,
      },
      app.me,
      app.now,
      false,
    ),
  );
  const earliest = $derived(app.events.length ? Date.parse(app.events[app.events.length - 1].at) : app.now.getTime() - 30 * 864e5);
  const buckets = $derived(bucketList(app.view.period, app.view.group, app.settings.weekStart, app.now, earliest));
  const series = $derived.by(() => {
    const idx = new Map(buckets.map((d, i) => [d.getTime(), i]));
    const s: Record<string, number[]> = {};
    for (const k of TREND_KINDS) s[k] = Array.from({ length: buckets.length }, () => 0);
    for (const e of evs) {
      const i = idx.get(floorToUnit(new Date(e.at), unit, app.settings.weekStart).getTime());
      if (i !== undefined && s[e.kind]) s[e.kind][i]++;
    }
    return s;
  });
  const W = $derived(Math.max(240, Math.min(900, width) - 26));
  const H = 112,
    pl = 28,
    pt = 8,
    pb = 18;
  const ch = H - pt - pb;

  function chart(k: TrendKind) {
    const counts = series[k];
    const max = Math.max(1, ...counts);
    const top = max <= 4 ? max : Math.ceil(max / 2) * 2;
    const n = buckets.length,
      cw = W - pl,
      bw = cw / n,
      gap = bw > 4 ? Math.min(2, bw * 0.2) : 0;
    const bars: { x: number; y: number; w: number; h: number; label: string }[] = [];
    const ticks: { x: number; text: string; anchor: string }[] = [];
    let lastTickX = -99;
    buckets.forEach((d, i) => {
      const x = pl + i * bw,
        c = counts[i];
      if (c) {
        const h = Math.max(1.5, (c / top) * ch);
        bars.push({ x: x + gap / 2, y: pt + ch - h, w: Math.max(1, bw - gap), h, label: `${bucketLabel(d)}: ${c}` });
      }
      let tick: string | null = null;
      if (unit === "hour") {
        if (d.getHours() % 6 === 0) tick = fmtTime(d, app.settings);
      } else if (unit === "month") tick = d.toLocaleDateString("en-US", { month: "short" });
      else if (i === 0 || d.getMonth() !== buckets[i - 1].getMonth()) tick = d.toLocaleDateString("en-US", { month: "short" });
      else if (unit === "day" && buckets.length <= 31 && d.getDate() % 5 === 0) tick = String(d.getDate());
      if (tick !== null && x - lastTickX >= 28) {
        ticks.push({ x: x + (unit === "month" ? bw / 2 : 0), text: tick, anchor: unit === "month" ? "middle" : "start" });
        lastTickX = x;
      }
    });
    return { top, bars, ticks, rx: bw > 6 ? 1.5 : 0 };
  }
  function bucketLabel(d: Date) {
    if (unit === "hour") return fmtTime(d, app.settings);
    if (unit === "month") return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    return (unit === "week" ? "Week of " : "") + fmtDate(d, app.settings);
  }
  function drop(to: TrendKind) {
    if (!dragK || dragK === to) {
      dragK = null;
      overK = null;
      return;
    }
    const o = order.filter((k) => k !== dragK);
    o.splice(o.indexOf(to), 0, dragK);
    app.setTrendOrder(o);
    dragK = null;
    overK = null;
  }
  async function move(e: KeyboardEvent, k: TrendKind) {
    const i = order.indexOf(k);
    const j = ({ ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: order.length - 1 } as Record<string, number>)[e.key];
    if (j === undefined) return;
    e.preventDefault();
    if (j < 0 || j >= order.length || j === i) return;
    const o = order.filter((x) => x !== k);
    o.splice(j, 0, k);
    app.setTrendOrder(o);
    // The keyed panel is moved in the DOM, which drops focus; put it back on the same handle.
    await flush();
    document.querySelector<HTMLElement>(`.tpanel[data-tk="${k}"] .grip`)?.focus();
  }
  const total = (k: TrendKind) => series[k].reduce((a, b) => a + b, 0);
</script>

<div id="trends" bind:clientWidth={width}>
  <div class="thdr">
    <div class="day">Trends</div>
    <span class="meta">one bar per {unit}</span>
  </div>
  <div id="tpanels" role="list">
    {#each order as k (k)}
      {@const [name, icon, color] = TKINDS[k]}
      {@const c = closed.has(k)}
      <section
        class="card tpanel"
        role="listitem"
        class:collapsed={c}
        class:dragging={dragK === k}
        class:over={overK === k}
        draggable="true"
        data-tk={k}
        ondragstart={(e) => {
          dragK = k;
          e.dataTransfer?.setData("text/plain", k);
        }}
        ondragover={(e) => {
          e.preventDefault();
          if (dragK && dragK !== k) overK = k;
        }}
        ondragleave={() => {
          if (overK === k) overK = null;
        }}
        ondrop={(e) => {
          e.preventDefault();
          drop(k);
        }}
        ondragend={() => {
          dragK = null;
          overK = null;
        }}
      >
        <div class="thead">
          <button
            type="button"
            class="grip"
            title="Drag, or press the arrow keys, to reorder"
            aria-label="Move {name}"
            aria-keyshortcuts="ArrowUp ArrowDown Home End"
            onkeydown={(e) => move(e, k)}
            ><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"
              ><path
                d="M10 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm-4 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm4-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm-4 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm4-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM6 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
              /></svg
            ></button
          >
          <button type="button" class="tname tog" aria-expanded={!c} onclick={() => app.toggleTrendClosed(k)}
            ><Icon name="chevron-down" /><span style="color:var({color})"><Icon name={icon} /></span>{name}</button
          >
          <span class="tper">{periodName(app.view.period).toLowerCase()}</span>
          <span class="spacer"></span>
          <span class="tsum" title="{total(k)} {name.toLowerCase()} · {periodName(app.view.period).toLowerCase()}"
            >{total(k).toLocaleString()}</span
          >
        </div>
        {#if !c}
          {@const ch_ = chart(k)}
          <div class="tbody">
            <svg viewBox="0 0 {W} {H}" width={W} height={H} role="img" aria-label="{name} per {unit}">
              <line class="gl" x1={pl} x2={W} y1={pt} y2={pt} /><line class="gl" x1={pl} x2={W} y1={pt + ch / 2} y2={pt + ch / 2} />
              <text class="ax" x={pl - 6} y={pt + 3} text-anchor="end">{ch_.top}</text>
              {#if ch_.top % 2 === 0 && ch_.top > 1}<text class="ax" x={pl - 6} y={pt + ch / 2 + 3} text-anchor="end">{ch_.top / 2}</text
                >{/if}
              <text class="ax" x={pl - 6} y={pt + ch + 3} text-anchor="end">0</text>
              {#each ch_.bars as b, i (i)}<rect
                  x={b.x.toFixed(2)}
                  y={b.y.toFixed(2)}
                  width={b.w.toFixed(2)}
                  height={b.h.toFixed(2)}
                  rx={ch_.rx}
                  fill="var({color})"><title>{b.label}</title></rect
                >{/each}
              {#each ch_.ticks as t, i (i)}<text class="ax" x={t.x.toFixed(1)} y={H - 4} text-anchor={t.anchor}>{t.text}</text>{/each}
              <line class="bl" x1={pl} x2={W} y1={pt + ch + 0.5} y2={pt + ch + 0.5} />
            </svg>
          </div>
        {/if}
      </section>
    {/each}
  </div>
  <p class="tnote">Same period, grouping and filters as the feed. Feed data starts {fmtDate(new Date(earliest), app.settings)}.</p>
</div>
