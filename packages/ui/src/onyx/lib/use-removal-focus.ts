/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { isFocusableCandidate } from "./use-roving-focus";

const controls = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]';
interface FocusSnapshot {
  item: HTMLElement;
  control: HTMLElement;
  index: number;
  slot: string | null;
  controlIndex: number;
}
/** Restore focus after a focused item disappears, including controlled/async removals. */
export function useRemovalFocus<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  selector: string,
  options: { fallbackRef?: React.RefObject<HTMLElement | null> | undefined; onEmpty?: (() => void) | undefined; returnToPrevious?: boolean | undefined } = {},
) {
  const snapshot = React.useRef<FocusSnapshot | null>(null);
  const previous = React.useRef<HTMLElement | null>(null);
  const settings = React.useRef(options);
  settings.current = options;
  const captureFocus = (event: React.FocusEvent<T>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget instanceof HTMLElement)
      previous.current = event.relatedTarget;
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>(selector);
    if (!item || !event.currentTarget.contains(item)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector));
    snapshot.current = { item, control: target, index: items.indexOf(item), slot: target.getAttribute("data-slot"), controlIndex: Array.from(item.querySelectorAll(controls)).indexOf(target) };
  };
  const restore = React.useCallback(() => {
    const root = ref.current, saved = snapshot.current;
    if (!root || !saved) return;
    if (root.contains(saved.item)) {
      saved.index = Array.from(root.querySelectorAll(selector)).indexOf(saved.item);
      return;
    }
    snapshot.current = null;
    // Never steal focus when the user has already moved to another control.
    const active = root.ownerDocument.activeElement;
    if (active instanceof HTMLElement && active !== root.ownerDocument.body && active !== saved.control && !saved.item.contains(active)) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(selector));
    const start = Math.min(saved.index, items.length - 1);
    const neighbours = [...items.slice(start), ...items.slice(0, start).reverse()];
    for (const neighbour of neighbours) {
      const candidates = Array.from(neighbour.querySelectorAll<HTMLElement>(controls)).filter(isFocusableCandidate);
      const equivalent = candidates.find(el => saved.slot && el.getAttribute("data-slot") === saved.slot) ?? candidates[saved.controlIndex] ?? candidates[0];
      // Prefer the same control, then try the remaining controls and neighbours.
      for (const candidate of [equivalent, ...candidates.filter(el => el !== equivalent)]) {
        if (!candidate) continue;
        candidate.focus();
        if (root.ownerDocument.activeElement === candidate) return;
      }
    }
    settings.current.onEmpty?.();
    if (root.ownerDocument.activeElement !== active) return;
    const fallback = settings.current.fallbackRef?.current ?? (settings.current.returnToPrevious ? previous.current : null);
    if (fallback && isFocusableCandidate(fallback)) {
      fallback.focus();
      if (root.ownerDocument.activeElement === fallback) return;
    }
    root.tabIndex = -1;
    root.focus();
  }, [ref, selector]);
  React.useLayoutEffect(() => { restore(); });
  React.useEffect(() => {
    const observer = new MutationObserver(restore);
    if (ref.current) observer.observe(ref.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, restore]);
  return { captureFocus, restore };
}
