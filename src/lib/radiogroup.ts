/**
 * Svelte action for `role="radiogroup"` containers whose options are `role="radio"` buttons (segmented controls, swatches).
 * Follows the WAI-ARIA radio group pattern: one tab stop (the checked option), arrow keys and Home/End move focus and select.
 */
export function radiogroup(node: HTMLElement) {
  const radios = () => [...node.querySelectorAll<HTMLElement>('[role="radio"]')];
  const sync = () => {
    const all = radios();
    const checked = all.find((r) => r.getAttribute("aria-checked") === "true") ?? all[0];
    for (const r of all) r.tabIndex = r === checked ? 0 : -1;
  };
  const onKey = (ev: KeyboardEvent) => {
    const all = radios();
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next =
      ev.key === "ArrowRight" || ev.key === "ArrowDown"
        ? (i + 1) % all.length
        : ev.key === "ArrowLeft" || ev.key === "ArrowUp"
          ? (i - 1 + all.length) % all.length
          : ev.key === "Home"
            ? 0
            : ev.key === "End"
              ? all.length - 1
              : -1;
    if (next < 0) return;
    ev.preventDefault();
    all[next].focus();
    all[next].click();
  };
  const observer = new MutationObserver(sync);
  observer.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-checked"] });
  node.addEventListener("keydown", onKey);
  sync();
  return {
    destroy() {
      observer.disconnect();
      node.removeEventListener("keydown", onKey);
    },
  };
}
