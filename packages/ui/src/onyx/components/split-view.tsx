/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useControllableState } from "../lib/use-controllable-state";
import { useComposedRefs } from "../lib/compose-refs";
import { ResizeHandle, type ResizeHandleProps } from "./resize-handle";

export interface PaneConstraints {
  minSize?: number | undefined;
  maxSize?: number | undefined;
  collapsible?: boolean | undefined;
  collapsedSize?: number | undefined;
  snap?: readonly number[] | undefined;
}
const bounds = (pane: PaneConstraints = {}) => ({
  min: pane.minSize ?? 0,
  max: pane.maxSize ?? 100,
  collapsed: pane.collapsedSize ?? 0,
});
/** All sizes are percentages. Feasible constraints preserve the total exactly. */
export function normalizeSplitSizes(
  sizes: readonly number[],
  constraints: readonly PaneConstraints[] = [],
): number[] {
  if (!sizes.length) return [];
  const safe = sizes.map((value) =>
    Number.isFinite(value) ? Math.max(0, value) : 0,
  );
  const total = safe.reduce((sum, size) => sum + size, 0);
  let result = safe.map((size) =>
    total > 0 ? (size * 100) / total : 100 / sizes.length,
  );
  result = result.map((size, index) => {
    const pane = constraints[index] ?? {};
    const { min, max, collapsed } = bounds(pane);
    return pane.collapsible && sizes[index] === collapsed
      ? collapsed
      : Math.min(max, Math.max(min, size));
  });
  for (let iteration = 0; iteration < sizes.length + 2; iteration++) {
    const remaining = 100 - result.reduce((sum, size) => sum + size, 0);
    if (Math.abs(remaining) < 0.00001) break;
    const available = result.map((size, index) => {
      const pane = constraints[index] ?? {};
      const { min, max, collapsed } = bounds(pane);
      return pane.collapsible && size === collapsed
        ? 0
        : remaining > 0
          ? Math.max(0, max - size)
          : Math.max(0, size - min);
    });
    const capacity = available.reduce((sum, value) => sum + value, 0);
    if (!capacity) break;
    result = result.map(
      (size, index) =>
        size +
        (Math.sign(remaining) *
          Math.min(Math.abs(remaining), capacity) *
          available[index]!) /
          capacity,
    );
  }
  return result;
}
/** Resize only the adjacent pair, preserving its combined size and other panes. */
export function resizeSplitSizes(
  sizes: readonly number[],
  index: number,
  nextSize: number,
  constraints: readonly PaneConstraints[] = [],
  snapThreshold = 1,
): number[] {
  if (index < 0 || index >= sizes.length - 1) return [...sizes];
  const a = constraints[index] ?? {},
    b = constraints[index + 1] ?? {};
  const A = bounds(a),
    B = bounds(b),
    total = sizes[index]! + sizes[index + 1]!;
  const aMin = Math.max(A.min, total - B.max),
    aMax = Math.min(A.max, total - B.min);
  let next = nextSize;
  if (
    a.collapsible &&
    next < (A.min + A.collapsed) / 2 &&
    total - A.collapsed >= B.min &&
    total - A.collapsed <= B.max
  )
    next = A.collapsed;
  else if (
    b.collapsible &&
    total - next < (B.min + B.collapsed) / 2 &&
    total - B.collapsed >= A.min &&
    total - B.collapsed <= A.max
  )
    next = total - B.collapsed;
  else {
    next = Math.min(aMax, Math.max(aMin, next));
    const snaps = [
      ...(a.snap ?? []),
      ...(b.snap ?? []).map((value) => total - value),
    ];
    const snap = snaps.find(
      (value) =>
        value >= aMin &&
        value <= aMax &&
        Math.abs(value - next) <= snapThreshold,
    );
    next = snap ?? next;
  }
  const result = [...sizes];
  result[index] = next;
  result[index + 1] = total - next;
  return result;
}
interface SplitContext {
  sizes: readonly number[];
  defaults: readonly number[];
  constraints: PaneConstraints[];
  orientation: "horizontal" | "vertical";
  extent: number;
  paneIds: string[];
  resize: (index: number, value: number) => void;
}
const Context = React.createContext<SplitContext | null>(null);
export const splitViewVariants = cva("onyx-split-view");
export const splitViewPaneVariants = cva("onyx-split-view-pane");
export interface SplitViewSizingOptions {
  orientation?: "horizontal" | "vertical" | undefined;
  sizes?: readonly number[] | undefined;
  defaultSizes?: readonly number[] | undefined;
  onSizesChange?: ((sizes: number[]) => void) | undefined;
  autoSaveId?: string | undefined;
  constraints?: readonly (PaneConstraints & {
    minPixels?: number | undefined;
    maxPixels?: number | undefined;
  })[] | undefined;
}
export function useSplitView({
  orientation = "horizontal",
  sizes: controlled,
  defaultSizes = [50, 50],
  onSizesChange,
  autoSaveId,
  constraints: supplied = [],
}: SplitViewSizingOptions = {}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [extent, setExtent] = React.useState(0);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const handles = Array.from(element.children).filter(
        (child) => child.getAttribute("role") === "separator",
      );
      const handleExtent = handles.reduce((sum, child) => {
        const rect = child.getBoundingClientRect();
        return sum + (orientation === "horizontal" ? rect.width : rect.height);
      }, 0);
      setExtent(
        Math.max(
          0,
          (orientation === "horizontal"
            ? element.clientWidth
            : element.clientHeight) - handleExtent,
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [orientation]);
  const constraints = supplied.map((pane) => ({
    ...pane,
    minSize: Math.max(
      pane.minSize ?? 0,
      extent > 0 && pane.minPixels !== undefined
        ? (pane.minPixels * 100) / extent
        : 0,
    ),
    maxSize: Math.min(
      pane.maxSize ?? 100,
      extent > 0 && pane.maxPixels !== undefined
        ? (pane.maxPixels * 100) / extent
        : 100,
    ),
  }));
  const defaults = normalizeSplitSizes(defaultSizes, constraints);
  const [saved] = React.useState(() => {
    try {
      if (!autoSaveId || typeof localStorage === "undefined") return defaultSizes;
      const stored: unknown = JSON.parse(
        localStorage.getItem(`onyx:split:${autoSaveId}`) ?? "null",
      );
      return Array.isArray(stored) &&
        stored.length === defaultSizes.length &&
        stored.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        )
        ? (stored as number[])
        : defaultSizes;
    } catch {
      return defaultSizes;
    }
  });
  const [rawSizes, setSizes] = useControllableState<readonly number[]>({
    value: controlled,
    defaultValue: saved,
    onChange: (value) => onSizesChange?.([...value]),
  });
  const sizes = normalizeSplitSizes(
    rawSizes.length === defaultSizes.length ? rawSizes : defaults,
    constraints,
  );
  React.useEffect(() => {
    if (autoSaveId)
      try {
        localStorage.setItem(`onyx:split:${autoSaveId}`, JSON.stringify(sizes));
      } catch {
        /* Storage can be unavailable; resizing still works. */
      }
  }, [autoSaveId, JSON.stringify(sizes)]);
  return {
    ref,
    sizes,
    defaults,
    constraints,
    orientation,
    extent,
    setSizes,
    resize: (index: number, value: number) =>
      setSizes(resizeSplitSizes(sizes, index, value, constraints)),
    reset: () => setSizes(defaults),
  };
}
export interface SplitViewProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue">,
    Omit<SplitViewSizingOptions, "constraints"> {
  asChild?: boolean | undefined;
  handleProps?: Omit<
    ResizeHandleProps,
    "value" | "onValueChange" | "orientation"
  > | undefined;
}
export const SplitView = React.forwardRef<HTMLDivElement, SplitViewProps>(
  (
    {
      orientation = "horizontal",
      sizes: controlled,
      defaultSizes,
      onSizesChange,
      autoSaveId,
      asChild,
      handleProps,
      children,
      className,
      ...props
    },
    forwardedRef,
  ) => {
    const child =
      asChild && React.isValidElement<{ children?: React.ReactNode | undefined }>(children)
        ? children
        : null;
    const panes = React.Children.toArray(
      child ? child.props.children : children,
    ).filter(React.isValidElement) as React.ReactElement<SplitViewPaneProps>[];
    const constraints = panes.map((pane) => ({
      minSize: pane.props.minSize,
      maxSize: pane.props.maxSize,
      minPixels: pane.props.minPixels,
      maxPixels: pane.props.maxPixels,
      collapsible: pane.props.collapsible,
      collapsedSize: pane.props.collapsedSize,
      snap: pane.props.snap,
    }));
    const model = useSplitView({
      sizes: controlled,
      defaultSizes:
        defaultSizes ??
        panes.map((pane) => pane.props.defaultSize ?? 100 / panes.length),
      onSizesChange,
      autoSaveId,
      constraints,
      orientation,
    });
    const ref = useComposedRefs(forwardedRef, model.ref);
    const id = React.useId();
    const paneIds = panes.map(
      (pane, index) => pane.props.id ?? `${id}-pane-${index}`,
    );
    const content = panes.map((pane, index) => (
      <React.Fragment key={pane.key ?? index}>
        {React.cloneElement(pane, { index, id: paneIds[index] })}
        {index < panes.length - 1 && (
          <SplitViewHandle index={index} {...handleProps} />
        )}
      </React.Fragment>
    ));
    const Component = asChild ? Slot : "div";
    return (
      <Context.Provider value={{ ...model, paneIds }}>
        <Component
          ref={ref}
          data-slot="split-view"
          data-orientation={orientation}
          className={cn(splitViewVariants(), className)}
          {...props}
        >
          {child ? React.cloneElement(child, {}, content) : content}
        </Component>
      </Context.Provider>
    );
  },
);
SplitView.displayName = "SplitView";
export interface SplitViewPaneProps
  extends React.HTMLAttributes<HTMLDivElement>, PaneConstraints {
  defaultSize?: number | undefined;
  minPixels?: number | undefined;
  maxPixels?: number | undefined;
  asChild?: boolean | undefined;
  index?: number | undefined;
}
export const SplitViewPane = React.forwardRef<
  HTMLDivElement,
  SplitViewPaneProps
>(
  (
    {
      index = 0,
      minSize,
      maxSize,
      minPixels,
      maxPixels,
      collapsible,
      collapsedSize,
      snap,
      defaultSize,
      asChild,
      className,
      style,
      ...props
    },
    ref,
  ) => {
    const context = React.useContext(Context);
    if (!context) throw new Error("SplitViewPane requires SplitView");
    const size = context.sizes[index];
    const Component = asChild ? Slot : "div";
    return (
      <Component
        ref={ref}
        data-slot="split-view-pane"
        data-orientation={context.orientation}
        data-state={size === (collapsedSize ?? 0) ? "collapsed" : "expanded"}
        inert={size === (collapsedSize ?? 0) ? true : undefined}
        hidden={size === 0}
        className={cn(splitViewPaneVariants(), className)}
        style={{ flexGrow: 0, flexShrink: 1, flexBasis: `${size}%`, ...style }}
        {...props}
      />
    );
  },
);
SplitViewPane.displayName = "SplitViewPane";
export const SplitViewHandle = React.forwardRef<
  HTMLDivElement,
  Omit<ResizeHandleProps, "value" | "onValueChange"> & { index: number }
>(({ index, className, ...props }, ref) => {
  const context = React.useContext(Context);
  if (!context) throw new Error("SplitViewHandle requires SplitView");
  const a = bounds(context.constraints[index]),
    b = bounds(context.constraints[index + 1]);
  const total = context.sizes[index]! + context.sizes[index + 1]!;
  return (
    <ResizeHandle
      ref={ref}
      data-slot="split-view-handle"
      aria-label={`Resize pane ${index + 1}`}
      aria-controls={context.paneIds[index]}
      aria-valuetext={`${Math.round(context.sizes[index]!)}%`}
      orientation={
        context.orientation === "horizontal" ? "vertical" : "horizontal"
      }
      value={context.sizes[index]}
      defaultValue={context.defaults[index]}
      onValueChange={(value) => context.resize(index, value)}
      min={Math.max(a.min, total - b.max)}
      max={Math.min(
        a.max,
        total -
          (context.constraints[index + 1]?.collapsible ? b.collapsed : b.min),
      )}
      collapsible={context.constraints[index]?.collapsible}
      collapsedSize={a.collapsed}
      unitsPerPixel={context.extent > 0 ? 100 / context.extent : 1}
      className={cn("onyx-split-view-handle", className)}
      {...props}
    />
  );
});
SplitViewHandle.displayName = "SplitViewHandle";
