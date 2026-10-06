/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';

import { cn } from '../lib/cn';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  min?: number;
  max?: number;
  indicatorClassName?: string;
  indicatorStyle?: React.CSSProperties;
}

export function getProgressPercent(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 0;
  }

  const clampedValue = Math.min(max, Math.max(min, value));
  return ((clampedValue - min) / (max - min)) * 100;
}

export const progressClassName =
  'relative h-2 w-full overflow-hidden rounded-full bg-[var(--onyx-control-bg)]';

export const progressIndicatorClassName =
  'h-full rounded-full bg-[var(--onyx-control-focus-ring)] transition-[width] duration-150 ease-out';

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      className,
      value = 0,
      min = 0,
      max = 100,
      indicatorClassName,
      indicatorStyle,
      ...props
    },
    ref
  ) => {
    const resolvedMin = Number.isFinite(min) ? min : 0;
    const resolvedMax = Number.isFinite(max) && max > resolvedMin ? max : resolvedMin + 100;
    const resolvedValue = Number.isFinite(value)
      ? Math.min(resolvedMax, Math.max(resolvedMin, value))
      : resolvedMin;
    const progressPercent = getProgressPercent(resolvedValue, resolvedMin, resolvedMax);

    return (
      <div
        ref={ref}
        data-slot="progress"
        role="progressbar"
        aria-valuemin={resolvedMin}
        aria-valuemax={resolvedMax}
        aria-valuenow={resolvedValue}
        className={cn(progressClassName, className)}
        {...props}
      >
        <div
          data-slot="progress-indicator"
          className={cn(progressIndicatorClassName, indicatorClassName)}
          style={{
            ...indicatorStyle,
            width: `${progressPercent}%`
          }}
        />
      </div>
    );
  }
);
Progress.displayName = 'Progress';
