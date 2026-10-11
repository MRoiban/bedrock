/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../lib/cn";
import { useComposedRefs } from "../lib/compose-refs";
export { calculateMeasuredVirtualWindow, type MeasuredVirtualWindow } from '../lib/measured-virtual-window';

export const virtualListVariants = cva("onyx-virtual-list");
export interface UseVirtualListOptions {
  count: number;
  getKey?: ((index: number) => React.Key) | undefined;
  /** Fixed height, or estimate for measured rows. Defaults to the density row token. */
  rowHeight?: number | undefined;
  measured?: boolean | undefined;
  overscan?: number | undefined;
  activeIndex?: number | undefined;
  enabled?: boolean | undefined;
}
export function useVirtualList({
  count,
  getKey,
  rowHeight,
  measured = false,
  overscan = 4,
  activeIndex,
  enabled = true,
}: UseVirtualListOptions) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [tokenHeight, setTokenHeight] = React.useState(22);
  React.useLayoutEffect(() => {
    if (!ref.current || rowHeight !== undefined) return;
    const read = () => {
      const element = ref.current!;
      // Resolve any valid CSS length (including rem/calc), rather than treating
      // a custom property's numeric prefix as a CSS-pixel measurement.
      const probe = element.ownerDocument.createElement("div");
      probe.dataset.slot = "virtual-list-metric";
      probe.setAttribute("aria-hidden", "true");
      Object.assign(probe.style, {
        position: "fixed",
        visibility: "hidden",
        pointerEvents: "none",
        width: "0",
        height: "var(--onyx-row-height)",
      });
      element.appendChild(probe);
      const height = parseFloat(getComputedStyle(probe).height);
      probe.remove();
      if (height > 0) setTokenHeight(height);
    };
    read();
    const observer = new MutationObserver(read);
    let parent: HTMLElement | null = ref.current;
    while (parent) {
      observer.observe(parent, {
        attributes: true,
        attributeFilter: ["data-density", "style", "class"],
      });
      parent = parent.parentElement;
    }
    return () => observer.disconnect();
  }, [rowHeight]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    getScrollElement: () => ref.current,
    estimateSize: () => rowHeight ?? tokenHeight,
    ...(getKey ? { getItemKey: getKey } : {}),
    overscan,
    enabled,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      if (
        activeIndex !== undefined &&
        activeIndex >= 0 &&
        activeIndex < count &&
        !indices.includes(activeIndex)
      )
        indices.push(activeIndex);
      return indices.sort((a, b) => a - b);
    },
  });
  React.useLayoutEffect(() => {
    virtualizer.measure();
  }, [rowHeight, tokenHeight, virtualizer]);
  const scrollIntoView = React.useCallback(
    (index: number) => virtualizer.scrollToIndex(index, { align: "auto" }),
    [virtualizer],
  );
  React.useLayoutEffect(() => {
    if (enabled && activeIndex !== undefined && activeIndex >= 0)
      scrollIntoView(activeIndex);
  }, [activeIndex, enabled, scrollIntoView]);
  return {
    ref,
    virtualizer,
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    scrollIntoView,
    measureElement: measured ? virtualizer.measureElement : undefined,
  };
}
export interface VirtualListProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "children">,
    UseVirtualListOptions {
  children: (index: number) => React.ReactNode;
  asChild?: boolean;
  /** Element receiving viewport props when asChild is true. */
  viewport?: React.ReactElement;
}
export const VirtualList = React.forwardRef<HTMLDivElement, VirtualListProps>(
  (
    {
      className,
      children,
      count,
      getKey,
      rowHeight,
      measured,
      overscan,
      activeIndex,
      enabled,
      asChild,
      viewport,
      ...props
    },
    forwardedRef,
  ) => {
    const list = useVirtualList({
      count,
      getKey,
      rowHeight,
      measured,
      overscan,
      activeIndex,
      enabled,
    });
    const ref = useComposedRefs(forwardedRef, list.ref);
    const Component = asChild ? Slot : "div";
    const content = (
      <div
        data-slot="virtual-list-content"
        style={{ height: list.totalSize, position: "relative" }}
      >
        {list.virtualItems.map((row) => (
          <div
            key={row.key}
            data-slot="virtual-list-item"
            data-index={row.index}
            ref={list.measureElement}
            style={{
              position: "absolute",
              top: 0,
              width: "100%",
              transform: `translateY(${row.start}px)`,
              height: measured ? undefined : row.size,
            }}
          >
            {children(row.index)}
          </div>
        ))}
      </div>
    );
    return (
      <Component
        ref={ref}
        data-slot="virtual-list"
        className={cn(virtualListVariants(), className)}
        {...props}
      >
        {asChild && viewport
          ? React.cloneElement(viewport, {}, content)
          : content}
      </Component>
    );
  },
);
VirtualList.displayName = "VirtualList";
