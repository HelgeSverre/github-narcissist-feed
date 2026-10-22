/**
 * Svelte action for `<svelte:document>` that adds arrow-key navigation to the filter rail (`.rail`) on top of the normal
 * Tab order, which is left alone: every control stays tabbable.
 *
 * - ArrowUp / ArrowDown move focus to the previous / next rail item; Home / End jump to the first / last. Items in
 *   collapsed sections are not rendered, so they are skipped for free. Radios move focus without changing selection
 *   (Space selects), overriding the native radio-group arrow behaviour.
 * - On a section header toggle, ArrowLeft collapses and ArrowRight expands; ArrowRight on an expanded header moves to
 *   its first item (tree-view style). ArrowLeft inside a section, or on another header control, moves to the header.
 *
 * Text inputs keep Left / Right / Home / End for the caret. The owner popover (`.pop`) is ignored.
 */
const ITEMS = "button:not(.secbtn):not(:disabled), input:not(:disabled)";

const headOf = (h: Element | null | undefined) => h?.querySelector<HTMLElement>(".sech") ?? null;

const itemsIn = (rail: HTMLElement) =>
  [...rail.querySelectorAll<HTMLElement>(ITEMS)].filter((el) => !el.closest(".pop") && el.getClientRects().length > 0);

export function railnav(node: Document, toggle: (id: string) => void) {
  const onKey = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const el = ev.target as HTMLElement;
    const rail = el.closest<HTMLElement>(".rail");
    if (!rail || el.closest(".pop")) return;
    const typing = el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "radio";
    const header = el.closest<HTMLElement>("h2[data-sec]");
    const go = (target: HTMLElement | null | undefined) => {
      ev.preventDefault();
      target?.focus();
    };

    switch (ev.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const all = itemsIn(rail);
        // The chevron is not an item of its own (it duplicates the header toggle); navigate from the toggle.
        const i = all.indexOf(header && el.classList.contains("secbtn") ? headOf(header)! : el);
        if (i >= 0) go(all[ev.key === "ArrowDown" ? i + 1 : i - 1]);
        return;
      }
      case "Home":
      case "End": {
        if (typing) return;
        const all = itemsIn(rail);
        go(ev.key === "Home" ? all[0] : all.at(-1));
        return;
      }
      case "ArrowLeft":
      case "ArrowRight": {
        if (typing) return;
        const left = ev.key === "ArrowLeft";
        if (header) {
          if (!el.classList.contains("sech") && !el.classList.contains("secbtn")) {
            go(left ? headOf(header) : null);
            return;
          }
          const body = header.nextElementSibling?.classList.contains("rsec") ? header.nextElementSibling : null;
          if (left === !!body) toggle(header.dataset.sec ?? "");
          else if (body) go(itemsIn(rail).find((x) => body.contains(x)));
          ev.preventDefault();
          return;
        }
        // Inside a section: Left goes to its header; Right does nothing (and keeps radios from changing selection).
        const sec = el.closest(".rsec");
        if (sec) go(left ? headOf(sec.previousElementSibling) : null);
        return;
      }
    }
  };

  node.addEventListener("keydown", onKey);
  return {
    update(next: (id: string) => void) {
      toggle = next;
    },
    destroy() {
      node.removeEventListener("keydown", onKey);
    },
  };
}
