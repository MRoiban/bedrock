/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useCallback, useRef, useState, type SetStateAction } from 'react';
export interface UseControllableStateOptions<T> {
  value?: T | undefined;
  defaultValue: T;
  onChange?: (value: T) => void;
}
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: UseControllableStateOptions<T>): [T, (next: SetStateAction<T>) => void] {
  const [internal, setInternal] = useState(defaultValue);
  const current = value === undefined ? internal : value;
  const latest = useRef({ current, value, onChange });
  latest.current = { current, value, onChange };
  const set = useCallback((next: SetStateAction<T>) => {
    const state = latest.current;
    const resolved =
      typeof next === 'function'
        ? (next as (value: T) => T)(state.current)
        : next;
    if (Object.is(resolved, state.current)) return;
    if (state.value === undefined) {
      latest.current.current = resolved;
      setInternal(resolved);
    }
    state.onChange?.(resolved);
  }, []);
  return [current, set];
}
