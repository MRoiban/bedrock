/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';

export interface FixedVirtualListWindow<T> {
  startIndex: number;
  endIndex: number;
  rows: T[];
  paddingTop: number;
  paddingBottom: number;
  totalHeight: number;
}

/** A request ID is handled once; changing the ID requests another reveal. */
export interface FixedVirtualListAnchor {
  id: string;
  rowKey: React.Key;
  block?: ScrollLogicalPosition | undefined;
}

export interface UseFixedVirtualListOptions<T> {
  listRef: React.RefObject<HTMLElement | null>;
  rows: readonly T[];
  getRowKey: (row: T) => React.Key;
  anchor?: FixedVirtualListAnchor | null | undefined;
  rowHeight?: number | undefined;
  overscan?: number | undefined;
  defaultViewportHeight?: number | undefined;
  /** Omit to discover the list's nearest scrolling ancestor. */
  scrollElementRef?: React.RefObject<HTMLElement | null> | undefined;
}

export function calculateFixedVirtualListWindow<T>({
  rows,
  scrollTop,
  viewportHeight,
  anchorIndex,
  rowHeight = 24,
  overscan = 6
}: {
  rows: readonly T[];
  scrollTop: number;
  viewportHeight: number;
  anchorIndex?: number | undefined;
  rowHeight?: number | undefined;
  overscan?: number | undefined;
}): FixedVirtualListWindow<T> {
  const rowCount = rows.length;
  const safeRowHeight = Math.max(1, rowHeight);
  const safeViewportHeight = Math.max(safeRowHeight, viewportHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const visibleRowCount = Math.max(
    1,
    Math.ceil(safeViewportHeight / safeRowHeight)
  );
  const maxStartIndex = Math.max(0, rowCount - visibleRowCount);
  const viewportStartIndex = Math.min(
    maxStartIndex,
    Math.max(0, Math.floor(Math.max(0, scrollTop) / safeRowHeight))
  );
  const normalizedAnchorIndex =
    anchorIndex === undefined
      ? null
      : Math.min(Math.max(0, anchorIndex), Math.max(0, rowCount - 1));
  const anchoredStartIndex =
    normalizedAnchorIndex === null
      ? viewportStartIndex
      : Math.min(
          maxStartIndex,
          Math.max(0, normalizedAnchorIndex - Math.floor(visibleRowCount / 2))
        );
  const startIndex = Math.max(0, anchoredStartIndex - safeOverscan);
  const endIndex = Math.min(
    rowCount,
    anchoredStartIndex + visibleRowCount + safeOverscan
  );

  return {
    startIndex,
    endIndex,
    rows: rows.slice(startIndex, endIndex),
    paddingTop: startIndex * safeRowHeight,
    paddingBottom: Math.max(0, (rowCount - endIndex) * safeRowHeight),
    totalHeight: rowCount * safeRowHeight
  };
}

function getOverflowY(element: HTMLElement): string {
  const view = element.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') {
    return '';
  }

  return view.getComputedStyle(element).overflowY;
}

export function findScrollableAncestor(
  listElement: HTMLElement | null
): HTMLElement | null {
  let current = listElement?.parentElement ?? null;

  while (current) {
    const overflowY = getOverflowY(current);
    if (
      overflowY === 'auto' ||
      overflowY === 'scroll' ||
      overflowY === 'overlay'
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

export function getFixedVirtualListOffset(
  listElement: HTMLElement,
  scrollContainer: HTMLElement
): number {
  if (
    typeof listElement.getBoundingClientRect !== 'function' ||
    typeof scrollContainer.getBoundingClientRect !== 'function'
  ) {
    return 0;
  }

  const listRect = listElement.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  return scrollContainer.scrollTop + listRect.top - containerRect.top;
}

function getLocalScrollTop(
  listElement: HTMLElement,
  scrollContainer: HTMLElement
): number {
  return Math.max(
    0,
    scrollContainer.scrollTop -
      getFixedVirtualListOffset(listElement, scrollContainer)
  );
}

export function scrollFixedVirtualRowIntoView(
  listElement: HTMLElement,
  scrollContainer: HTMLElement,
  rowIndex: number,
  block: ScrollLogicalPosition = 'nearest',
  rowHeight = 24
): void {
  const listOffset = getFixedVirtualListOffset(
    listElement,
    scrollContainer
  );
  const rowTop = listOffset + rowIndex * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const viewportTop = scrollContainer.scrollTop;
  const viewportBottom = viewportTop + scrollContainer.clientHeight;
  let target = viewportTop;

  if (block === 'center') {
    target = rowTop - (scrollContainer.clientHeight - rowHeight) / 2;
  } else if (block === 'start') {
    target = rowTop;
  } else if (block === 'end') {
    target = rowBottom - scrollContainer.clientHeight;
  } else if (rowTop < viewportTop) {
    target = rowTop;
  } else if (rowBottom > viewportBottom) {
    target = rowBottom - scrollContainer.clientHeight;
  }

  const maxScrollTop = Math.max(
    0,
    scrollContainer.scrollHeight - scrollContainer.clientHeight
  );
  scrollContainer.scrollTo({
    top: Math.min(maxScrollTop, Math.max(0, target)),
    behavior: 'auto'
  });
}

/** Fixed-height windows inside a native viewport, without replacing its DOM or scrolling. */
export function useFixedVirtualList<T>({
  listRef,
  rows,
  getRowKey,
  anchor = null,
  rowHeight = 24,
  overscan = 6,
  defaultViewportHeight = 360,
  scrollElementRef,
}: UseFixedVirtualListOptions<T>): FixedVirtualListWindow<T> {
  const safeRowHeight = Math.max(1, rowHeight);
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: defaultViewportHeight });
  const previousRowHeightRef = React.useRef(safeRowHeight);
  const [handledAnchorId, setHandledAnchorId] = React.useState<string | null>(null);
  const pendingAnchor = anchor && anchor.id !== handledAnchorId ? anchor : null;
  const anchorIndex = pendingAnchor ? rows.findIndex(row => getRowKey(row) === pendingAnchor.rowKey) : -1;

  const findViewport = React.useCallback(() =>
    scrollElementRef ? scrollElementRef.current : findScrollableAncestor(listRef.current),
  [listRef, scrollElementRef]);

  const measure = React.useCallback(() => {
    const listElement = listRef.current;
    const scrollContainer = findViewport();
    if (!listElement || !scrollContainer) return;
    const next = {
      scrollTop: getLocalScrollTop(listElement, scrollContainer),
      height: scrollContainer.clientHeight || defaultViewportHeight,
    };
    setViewport(current => current.scrollTop === next.scrollTop && current.height === next.height ? current : next);
  }, [listRef, findViewport, defaultViewportHeight]);

  React.useEffect(() => {
    const listElement = listRef.current;
    const scrollContainer = findViewport();
    if (!scrollContainer) return;
    measure();
    scrollContainer.addEventListener('scroll', measure, { passive: true });
    const view = scrollContainer.ownerDocument.defaultView;
    view?.addEventListener('resize', measure);
    const Observer = view?.ResizeObserver;
    const resize = Observer ? new Observer(measure) : null;
    resize?.observe(scrollContainer);
    if (listElement) resize?.observe(listElement);
    return () => {
      scrollContainer.removeEventListener('scroll', measure);
      view?.removeEventListener('resize', measure);
      resize?.disconnect();
    };
  }, [listRef, findViewport, measure]);

  React.useLayoutEffect(() => {
    const previousRowHeight = previousRowHeightRef.current;
    previousRowHeightRef.current = safeRowHeight;
    if (previousRowHeight === safeRowHeight) return;
    const listElement = listRef.current;
    const scrollContainer = findViewport();
    if (!listElement || !scrollContainer) return;
    const listOffset = getFixedVirtualListOffset(listElement, scrollContainer);
    // Keep the first visible row and its fractional offset. Headers are outside the scale calculation.
    if (scrollContainer.scrollTop > listOffset) {
      scrollContainer.scrollTop = listOffset + (scrollContainer.scrollTop - listOffset) * safeRowHeight / previousRowHeight;
    }
    measure();
  }, [listRef, findViewport, measure, safeRowHeight]);

  React.useLayoutEffect(() => {
    if (!pendingAnchor || anchorIndex < 0) return;
    const listElement = listRef.current;
    const scrollContainer = findViewport();
    if (!listElement || !scrollContainer) return;
    scrollFixedVirtualRowIntoView(listElement, scrollContainer, anchorIndex, pendingAnchor.block, safeRowHeight);
    measure();
    // Always release the temporary render window, even when the requested row was already visible.
    setHandledAnchorId(pendingAnchor.id);
  }, [listRef, findViewport, measure, pendingAnchor, anchorIndex, safeRowHeight]);

  return React.useMemo(() => calculateFixedVirtualListWindow({
    rows, rowHeight: safeRowHeight, overscan,
    scrollTop: viewport.scrollTop, viewportHeight: viewport.height,
    anchorIndex: pendingAnchor && anchorIndex >= 0 ? anchorIndex : undefined,
  }), [rows, safeRowHeight, overscan, viewport.scrollTop, viewport.height, pendingAnchor, anchorIndex]);
}

