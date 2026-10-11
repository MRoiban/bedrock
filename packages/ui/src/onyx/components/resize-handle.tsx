/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useControllableState } from "../lib/use-controllable-state";

export const resizeHandleVariants = cva("onyx-resize-handle", {
  variants: { orientation: { vertical: "", horizontal: "" } },
  defaultVariants: { orientation: "vertical" },
});
export interface UseResizableOptions {
  value?: number | undefined;
  defaultValue?: number | undefined;
  onValueChange?: ((value: number) => void) | undefined;
  min?: number | undefined;
  max?: number | undefined;
  orientation?: "horizontal" | "vertical" | undefined;
  disabled?: boolean | undefined;
  collapsible?: boolean | undefined;
  collapsedSize?: number | undefined;
  /** Convert CSS pixels to value units (SplitView uses percentage units). */
  unitsPerPixel?: number | undefined;
  direction?: 1 | -1 | undefined;
  snap?: readonly number[] | undefined;
  snapThreshold?: number | undefined;
  onResizeStart?: (() => void) | undefined;
  onResizeEnd?: (() => void) | undefined;
}
export function useResizable({
  value: controlled,
  defaultValue = 240,
  onValueChange,
  min = 0,
  max = 1000,
  orientation = "vertical",
  disabled = false,
  collapsible = false,
  collapsedSize = 0,
  unitsPerPixel = 1,
  direction = 1,
  snap = [],
  snapThreshold = 4,
  onResizeStart,
  onResizeEnd,
}: UseResizableOptions = {}) {
  const [rawValue, setRawValue] = useControllableState({
    value: controlled,
    defaultValue,
    onChange: onValueChange,
  });
  const clamp = (next: number) =>
    Math.min(Math.max(min, max), Math.max(min, next));
  const value =
    collapsible && rawValue === collapsedSize ? collapsedSize : clamp(rawValue);
  const [dragging, setDragging] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const start = React.useRef<{
    coordinate: number;
    value: number;
    pointerId: number;
  } | null>(null);
  const restored = React.useRef(value === collapsedSize ? defaultValue : value);
  if (value !== collapsedSize) restored.current = value;
  const setValue = (next: number) => {
    if (disabled) return;
    if (collapsible && next < (min + collapsedSize) / 2) {
      setRawValue(collapsedSize);
      return;
    }
    const clamped = clamp(next);
    const target = snap.find(
      (point) =>
        point >= min &&
        point <= max &&
        Math.abs(point - clamped) <= snapThreshold,
    );
    setRawValue(target ?? clamped);
  };
  const finish = (event: React.PointerEvent<HTMLElement>) => {
    if (start.current?.pointerId !== event.pointerId) return;
    start.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onResizeEnd?.();
  };
  const handleProps = {
    role: "separator",
    tabIndex: disabled ? -1 : 0,
    "aria-orientation": orientation,
    "aria-valuenow": value,
    "aria-valuemin": collapsible ? collapsedSize : min,
    "aria-valuemax": max,
    "aria-disabled": disabled || undefined,
    "data-orientation": orientation,
    "data-state": dragging ? "dragging" : hovered ? "hover" : "idle",
    "data-disabled": disabled ? "" : undefined,
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      start.current = {
        coordinate: orientation === "vertical" ? event.clientX : event.clientY,
        value,
        pointerId: event.pointerId,
      };
      setDragging(true);
      onResizeStart?.();
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const origin = start.current;
      if (!origin || origin.pointerId !== event.pointerId) return;
      setValue(
        origin.value +
          ((orientation === "vertical" ? event.clientX : event.clientY) -
            origin.coordinate) *
            unitsPerPixel *
            direction,
      );
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: () => {
      if (start.current) {
        start.current = null;
        setDragging(false);
        onResizeEnd?.();
      }
    },
    onDoubleClick: (event: React.MouseEvent<HTMLElement>) => {
      if (!disabled) {
        event.preventDefault();
        onResizeStart?.();
        setValue(defaultValue);
        onResizeEnd?.();
      }
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (disabled || event.defaultPrevented) return;
      const keys =
        orientation === "vertical"
          ? ["ArrowLeft", "ArrowRight"]
          : ["ArrowUp", "ArrowDown"];
      if (!keys.includes(event.key) && !['Home', 'End'].includes(event.key) && !(event.key === 'Enter' && collapsible)) return;
      onResizeStart?.();
      if (keys.includes(event.key))
        setValue(
          value +
            (event.key === keys[0] ? -1 : 1) *
              direction *
              (event.shiftKey ? 50 : 10) *
              unitsPerPixel,
        );
      else if (event.key === "Home")
        setRawValue(collapsible ? collapsedSize : min);
      else if (event.key === "End") setRawValue(max);
      else if (event.key === "Enter" && collapsible)
        setRawValue(
          value === collapsedSize ? clamp(restored.current) : collapsedSize,
        );
      else return;
      event.preventDefault();
      onResizeEnd?.();
    },
  } satisfies React.HTMLAttributes<HTMLElement> &
    Record<`data-${string}`, unknown>;
  return {
    value,
    setValue,
    dragging,
    hovered,
    collapsed: collapsible && value === collapsedSize,
    handleProps,
  };
}
export interface ResizeHandleProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange">,
    UseResizableOptions {
  asChild?: boolean | undefined;
  showSize?: boolean | undefined;
  formatValue?: ((value: number) => React.ReactNode) | undefined;
  grip?: boolean | undefined;
}
export const ResizeHandle = React.forwardRef<HTMLDivElement, ResizeHandleProps>(
  (
    {
      value,
      defaultValue,
      onValueChange,
      min,
      max,
      orientation,
      disabled,
      collapsible,
      collapsedSize,
      unitsPerPixel,
      direction,
      snap,
      snapThreshold,
      onResizeStart,
      onResizeEnd,
      asChild,
      showSize,
      formatValue,
      grip,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const model = useResizable({
      value,
      defaultValue,
      onValueChange,
      min,
      max,
      orientation,
      disabled,
      collapsible,
      collapsedSize,
      unitsPerPixel,
      direction,
      snap,
      snapThreshold,
      onResizeStart,
      onResizeEnd,
    });
    const Component = asChild ? Slot : "div";
    const merged: Record<string, unknown> = { ...model.handleProps, ...props };
    // Consumer handlers may cancel the default behavior.
    for (const key of Object.keys(model.handleProps)) {
      if (!key.startsWith("on")) continue;
      const own = model.handleProps[key as keyof typeof model.handleProps];
      const consumer = props[key as keyof typeof props];
      merged[key] = (event: React.SyntheticEvent<HTMLElement>) => {
        if (typeof consumer === "function")
          (consumer as (event: React.SyntheticEvent) => void)(event);
        if (!event.defaultPrevented && typeof own === "function")
          (own as (event: React.SyntheticEvent<HTMLElement>) => void)(event);
      };
    }
    return (
      <Component
        ref={ref}
        data-slot="resize-handle"
        className={cn(resizeHandleVariants({ orientation }), className)}
        {...merged}
      >
        {asChild ? <Slottable>{children}</Slottable> : children}
        {grip && <span data-slot="resize-handle-grip" aria-hidden="true" />}
        {showSize && (model.dragging || model.hovered) && (
          <span data-slot="resize-handle-tooltip" role="tooltip">
            {formatValue?.(model.value) ?? `${Math.round(model.value)}px`}
          </span>
        )}
      </Component>
    );
  },
);
ResizeHandle.displayName = "ResizeHandle";
