/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { useControllableState } from './use-controllable-state';

/** Observe native reset, including controls associated with an external form. */
export function useFormReset(
  element: React.RefObject<HTMLElement | null>,
  reset: () => void,
  formId?: string,
) {
  const latest = React.useRef(reset);
  latest.current = reset;
  React.useEffect(() => {
    const document = element.current?.ownerDocument;
    if (!document) return;
    const onReset = (event: Event) => {
      const node = element.current;
      const form = formId ? document.getElementById(formId) :
        (node instanceof HTMLInputElement || node instanceof HTMLButtonElement ? node.form : null) ?? node?.closest('form');
      if (event.target !== form) return;
      queueMicrotask(() => { if (!event.defaultPrevented) latest.current(); });
    };
    document.addEventListener('reset', onReset, true);
    return () => document.removeEventListener('reset', onReset, true);
  }, [element, formId]);
}

/** Controllable state with a silent reset to its mount-time uncontrolled default. */
export function useResettableState<T>({ value, defaultValue, onChange }: {
  value?: T; defaultValue: T; onChange?: (value: T) => void;
}): [T, (next: React.SetStateAction<T>) => void, () => void] {
  const initial = React.useRef(defaultValue);
  const silent = React.useRef(false);
  const [current, set] = useControllableState({
    value, defaultValue,
    onChange: (next: T) => { if (!silent.current) onChange?.(next); },
  });
  const reset = () => {
    if (value !== undefined) return;
    silent.current = true;
    try { set(initial.current); } finally { silent.current = false; }
  };
  return [current, set, reset];
}
