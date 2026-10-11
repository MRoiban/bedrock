/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useMemo, type Ref } from 'react';
/** React 19 callback-ref cleanup is retained for every composed ref. */
export function composeRefs<T>(
  ...refs: (Ref<T> | undefined)[]
): (node: T | null) => void | (() => void) {
  return (node) => {
    const cleanups = refs.map((ref) =>
      typeof ref === 'function'
        ? ref(node)
        : ref
          ? ((ref.current = node), undefined)
          : undefined,
    );
    return () =>
      refs.forEach((ref, i) => {
        if (typeof cleanups[i] === 'function') cleanups[i]();
        else if (typeof ref === 'function') ref(null);
        else if (ref) ref.current = null;
      });
  };
}
export function useComposedRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return useMemo(() => composeRefs(...refs), refs);
}
