/**
 * Svelte action for a group of checkboxes (the rail's Activity list): Shift+ArrowUp / Shift+ArrowDown extend a selection
 * from where it started, and Space then toggles every selected checkbox together. If any selected box is unchecked, all
 * become checked; otherwise all become unchecked. The selection clears on Escape, on a plain arrow key, on a mouse click
 * and when focus leaves the group.
 *
 * Toggling goes through each checkbox's own click, so the existing change handlers stay the single place that updates
 * state. Plain arrow navigation is left to railnav.ts, which ignores Shift.
 */
const SELECTED = "msel";

export function multiselect(node: HTMLElement) {
  let anchor: HTMLInputElement | null = null;
  let selected: HTMLInputElement[] = [];
  let swallowSpaceUp = false;

  const boxes = () =>
    [...node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')].filter((el) => el.getClientRects().length > 0);

  const paint = () => {
    for (const box of boxes()) box.closest("label")?.classList.toggle(SELECTED, selected.includes(box));
    if (selected.length > 1) node.dataset.selected = String(selected.length);
    else delete node.dataset.selected;
  };
  const clear = () => {
    anchor = null;
    selected = [];
    paint();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement) || el.type !== "checkbox" || ev.altKey || ev.ctrlKey || ev.metaKey) return;

    if (ev.shiftKey && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
      const all = boxes();
      const i = all.indexOf(el);
      if (i < 0) return;
      ev.preventDefault();
      if (!anchor || !all.includes(anchor)) anchor = el;
      const next = all[Math.max(0, Math.min(all.length - 1, ev.key === "ArrowDown" ? i + 1 : i - 1))];
      const [from, to] = [all.indexOf(anchor), all.indexOf(next)].toSorted((a, b) => a - b);
      selected = all.slice(from, to + 1);
      next.focus();
      paint();
      return;
    }

    if (ev.key === " " && selected.length > 1 && selected.includes(el)) {
      ev.preventDefault();
      swallowSpaceUp = true; // checkboxes toggle on keyup; this one is handled here
      const on = selected.some((box) => !box.checked);
      for (const box of selected) if (box.checked !== on) box.click();
      queueMicrotask(paint); // the list can re-render after the clicks
      return;
    }

    if (ev.key === "Escape" && selected.length) {
      ev.preventDefault();
      clear();
      return;
    }
    if (ev.key.startsWith("Arrow") && !ev.shiftKey) clear();
  };

  const onKeyUp = (ev: KeyboardEvent) => {
    if (ev.key === " " && swallowSpaceUp) {
      ev.preventDefault();
      swallowSpaceUp = false;
    }
  };
  const onFocusOut = (ev: FocusEvent) => {
    if (!node.contains(ev.relatedTarget as Node | null)) clear();
  };

  node.addEventListener("keydown", onKeyDown);
  node.addEventListener("keyup", onKeyUp);
  node.addEventListener("focusout", onFocusOut);
  node.addEventListener("pointerdown", clear);
  return {
    destroy() {
      node.removeEventListener("keydown", onKeyDown);
      node.removeEventListener("keyup", onKeyUp);
      node.removeEventListener("focusout", onFocusOut);
      node.removeEventListener("pointerdown", clear);
    },
  };
}
