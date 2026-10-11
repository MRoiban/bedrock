/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import type { CollectionKey } from '../components/listbox';

/** A visible row in preorder; the caller owns the hierarchy and item data. */
export interface TreeNavigationItem<T> {
  key: CollectionKey;
  depth: number;
  branch: boolean;
  expanded: boolean;
  label: string;
  data: T;
  disabled?: boolean | undefined;
}

export type TreeNavigationAction<T> =
  | { type: 'focus'; key: CollectionKey; item: T; extend: boolean }
  | { type: 'toggle'; key: CollectionKey; item: T }
  | { type: 'activate'; key: CollectionKey; item: T };

export interface TreeNavigationOptions<T> {
  rows: readonly TreeNavigationItem<T>[];
  focusedKey: CollectionKey | null;
  shiftKey?: boolean;
}

/** Resolve APG tree navigation without DOM, selection or expansion mutations. */
export function resolveTreeNavigationAction<T>(
  key: string,
  { rows, focusedKey, shiftKey = false }: TreeNavigationOptions<T>,
): TreeNavigationAction<T> | null {
  const available = rows.filter(row => !row.disabled);
  if (!available.length) return null;
  const focusedIndex = available.findIndex(row => row.key === focusedKey);
  const focus = (row: TreeNavigationItem<T>, extend = shiftKey): TreeNavigationAction<T> =>
    ({ type: 'focus', key: row.key, item: row.data, extend });
  const focusAt = (index: number) => focus(available[Math.max(0, Math.min(available.length - 1, index))]!);

  if (focusedIndex < 0) {
    return ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft'].includes(key)
      ? focusAt(key === 'End' ? available.length - 1 : 0)
      : null;
  }
  const focused = available[focusedIndex]!;
  const rowIndex = rows.indexOf(focused);
  switch (key) {
    case 'ArrowDown': return focusAt(focusedIndex + 1);
    case 'ArrowUp': return focusAt(focusedIndex - 1);
    case 'Home': return focusAt(0);
    case 'End': return focusAt(available.length - 1);
    case 'ArrowRight':
      if (!focused.branch) return null;
      if (!focused.expanded) return { type: 'toggle', key: focused.key, item: focused.data };
      for (let index = rowIndex + 1; index < rows.length && rows[index]!.depth > focused.depth; index++) {
        const child = rows[index]!;
        if (child.depth === focused.depth + 1 && !child.disabled) return focus(child);
      }
      return null;
    case 'ArrowLeft':
      if (focused.branch && focused.expanded) return { type: 'toggle', key: focused.key, item: focused.data };
      for (let index = rowIndex - 1; index >= 0; index--) {
        const parent = rows[index]!;
        if (parent.depth < focused.depth) return parent.depth === focused.depth - 1 && !parent.disabled ? focus(parent, false) : null;
      }
      return null;
    case 'Enter': return { type: 'activate', key: focused.key, item: focused.data };
    default: return null;
  }
}

/**
 * Case-insensitive, wrapping typeahead for a visible tree. Single/repeated
 * characters cycle after the focused row; longer prefixes include it so a
 * buffered search can refine its current match. Buffer timing belongs to the caller.
 */
export function findTreeTypeAheadMatch<T>(
  rows: readonly TreeNavigationItem<T>[], focusedKey: CollectionKey | null, prefix: string,
): T | null {
  const available = rows.filter(row => !row.disabled);
  if (!available.length || !prefix.length) return null;
  const needle = prefix.toLocaleLowerCase();
  const repeated = needle.length > 1 && [...needle].every(character => character === needle[0]);
  const search = repeated ? needle[0]! : needle;
  const index = available.findIndex(row => row.key === focusedKey);
  const startOffset = search.length === 1 ? 1 : 0;
  for (let step = 0; step < available.length; step++) {
    const row = available[(Math.max(index, -1) + startOffset + step + available.length) % available.length]!;
    if (row.label.toLocaleLowerCase().startsWith(search)) return row.data;
  }
  return null;
}
