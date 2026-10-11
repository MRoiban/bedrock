/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { displayToneClasses, type DisplayTone } from "./badge";
import { cn } from "../lib/cn";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  indeterminate?: boolean;
  tone?: DisplayTone;
  value?: number;
  min?: number;
  max?: number;
  indicatorClassName?: string;
  indicatorStyle?: React.CSSProperties;
}

export function getProgressPercent(value: number, min = 0, max = 100): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max <= min
  ) {
    return 0;
  }

  const clampedValue = Math.min(max, Math.max(min, value));
  return ((clampedValue - min) / (max - min)) * 100;
}

export const progressClassName = "onyx-progress onyx-track onyx-display-tone";
export const progressIndicatorClassName = "onyx-progress-indicator";
export const progressVariants = cva(progressClassName, {
  variants: { tone: displayToneClasses, indeterminate: { true: "onyx-progress--indeterminate", false: "" } },
  defaultVariants: { tone: "info", indeterminate: false },
});
export const progressIndicatorVariants = cva(progressIndicatorClassName);

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      className,
      asChild,
      indeterminate = false,
      tone = "info",
      children,
      value = 0,
      min = 0,
      max = 100,
      indicatorClassName,
      indicatorStyle,
      ...props
    },
    ref,
  ) => {
    const resolvedMin = Number.isFinite(min) ? min : 0;
    const resolvedMax =
      Number.isFinite(max) && max > resolvedMin ? max : resolvedMin + 100;
    const resolvedValue = Number.isFinite(value)
      ? Math.min(resolvedMax, Math.max(resolvedMin, value))
      : resolvedMin;
    const progressPercent = getProgressPercent(
      resolvedValue,
      resolvedMin,
      resolvedMax,
    );

    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="progress"
        role="progressbar"
        data-tone={tone}
        data-state={indeterminate ? "indeterminate" : "determinate"}
        aria-valuemin={resolvedMin}
        aria-valuemax={resolvedMax}
        aria-valuenow={indeterminate ? undefined : resolvedValue}
        className={cn(progressVariants({ tone, indeterminate }), className)}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <div
            data-slot="progress-indicator"
            className={cn(
              progressIndicatorClassName,
              indeterminate &&
                "animate-onyx-indeterminate motion-reduce:animate-none",
              indicatorClassName,
            )}
            style={{
              ...indicatorStyle,
              width: indeterminate ? "30%" : `${progressPercent}%`,
            }}
          />
        )}
      </Comp>
    );
  },
);
Progress.displayName = "Progress";
