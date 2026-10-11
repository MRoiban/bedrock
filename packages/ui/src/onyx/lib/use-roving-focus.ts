/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type FocusEvent,
} from 'react';
export interface UseRovingFocusOptions {
  orientation?: 'horizontal' | 'vertical' | 'both';
  loop?: boolean;
  dir?: 'ltr' | 'rtl';
  selector?: string;
}
const EDITING_SELECTOR = 'input:not([type=radio]):not([type=checkbox]):not([type=button]):not([type=submit]):not([type=reset]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"]';
const isEditing = (el: HTMLElement) => !!el.closest(EDITING_SELECTOR);
/** Shared eligibility for roving navigation and focus recovery after removal. */
export function isFocusableCandidate(element: HTMLElement): boolean {
  if (!element.isConnected ||
      element.matches(':disabled, input[type=hidden], [aria-disabled="true"], [data-disabled]') ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const visibility = element.ownerDocument.defaultView?.getComputedStyle(element).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none') return false;
  }
  return true;
}
/** DOM-driven so consumers can supply their own markup; disabled items are skipped. */
export function useRovingFocus<T extends HTMLElement = HTMLDivElement>({
  orientation = 'horizontal',
  loop = true,
  dir = 'ltr',
  selector = 'button, [role="button"], [role="radio"], [role="option"], a[href], input, select, textarea, [contenteditable], [role="combobox"], [data-roving-item]',
}: UseRovingFocusOptions = {}) {
  const ref = useRef<T>(null);
  const active = useRef<HTMLElement | null>(null);
  const items = useCallback(() =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>(selector) ?? []).filter(isFocusableCandidate), [selector]);
  const sync = useCallback(
    (target?: HTMLElement) => {
      const available = items();
      const all = available.filter((el) => !isEditing(el));
      const selected =
        target && all.includes(target)
          ? target
          : all.includes(active.current!)
            ? active.current
            : (all.find((el) => el.tabIndex === 0) ?? all[0]);
      ref.current?.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.tabIndex = available.includes(el) && isEditing(el) ? 0 : el === selected ? 0 : -1;
      });
      active.current = selected ?? null;
    },
    [items, selector],
  );
  useEffect(() => {
    sync();
    const observer = new MutationObserver(() => sync());
    if (ref.current)
      observer.observe(ref.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'inert',
          'aria-hidden',
          'style',
          'class',
          'type',
          'contenteditable',
          'disabled',
          'aria-disabled',
          'hidden',
          'data-disabled',
        ],
      });
    return () => observer.disconnect();
  }, [sync]);
  const onFocusCapture = useCallback(
    (event: FocusEvent<T>) => {
      const target = items().find(
        (el) => el === event.target || el.contains(event.target as Node),
      );
      if (target && !isEditing(target)) sync(target);
    },
    [items, sync],
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<T>) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      if (isEditing(event.target as HTMLElement)) return;
      const all = items().filter((el) => !isEditing(el));
      const current = all.findIndex(
        (el) => el === event.target || el.contains(event.target as Node),
      );
      if (current < 0) return;
      let next = current;
      const horizontal = orientation !== 'vertical',
        vertical = orientation !== 'horizontal';
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = all.length - 1;
      else if (horizontal && event.key === 'ArrowRight')
        next += dir === 'rtl' ? -1 : 1;
      else if (horizontal && event.key === 'ArrowLeft')
        next += dir === 'rtl' ? 1 : -1;
      else if (vertical && event.key === 'ArrowDown') next++;
      else if (vertical && event.key === 'ArrowUp') next--;
      else return;
      event.preventDefault();
      next = loop
        ? (next + all.length) % all.length
        : Math.max(0, Math.min(all.length - 1, next));
      sync(all[next]);
      all[next]?.focus();
    },
    [items, sync, orientation, loop, dir],
  );
  return { ref, onKeyDown, onFocusCapture, refresh: sync, getItems: items };
}
