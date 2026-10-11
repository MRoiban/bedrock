/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { displayToneClasses, type DisplayTone } from "./badge";
export const meterVariants = cva("onyx-meter onyx-display-tone", {
  variants: { tone: displayToneClasses },
  defaultVariants: { tone: "neutral" },
});
export interface MeterProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean | undefined;
  value: number;
  min?: number | undefined;
  max?: number | undefined;
  low?: number | undefined;
  high?: number | undefined;
  optimum?: number | undefined;
  tone?: DisplayTone | undefined;
  label?: React.ReactNode | undefined;
  valueText?: string | undefined;
}
export function useMeter({
  value,
  min = 0,
  max = 100,
  low,
  high,
  optimum,
  tone,
}: Pick<
  MeterProps,
  "value" | "min" | "max" | "low" | "high" | "optimum" | "tone"
>) {
  min = Number.isFinite(min) ? min : 0;
  max = Number.isFinite(max) && max > min ? max : min + 100;
  const now = Math.min(
    max,
    Math.max(min, Number.isFinite(value) ? value : min),
  );
  const lo = Math.min(max, Math.max(min, low ?? min));
  const hi = Math.min(max, Math.max(lo, high ?? max));
  const opt = Math.min(max, Math.max(min, optimum ?? (min + max) / 2));
  let inferred: DisplayTone = "success";
  if (opt < lo)
    inferred = now <= lo ? "success" : now <= hi ? "warning" : "danger";
  else if (opt > hi)
    inferred = now >= hi ? "success" : now >= lo ? "warning" : "danger";
  else inferred = now < lo || now > hi ? "warning" : "success";
  return {
    min,
    max,
    value: now,
    percent: ((now - min) / (max - min)) * 100,
    tone: tone ?? inferred,
  };
}
export const Meter = React.forwardRef<HTMLDivElement, MeterProps>(
  (
    {
      asChild,
      value,
      min,
      max,
      low,
      high,
      optimum,
      tone,
      label,
      valueText,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const model = useMeter({ value, min, max, low, high, optimum, tone });
    const id = React.useId();
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        role={asChild ? "meter" : undefined}
        aria-valuemin={asChild ? model.min : undefined}
        aria-valuemax={asChild ? model.max : undefined}
        aria-valuenow={asChild ? model.value : undefined}
        aria-valuetext={asChild ? valueText : undefined}
        data-slot="meter"
        data-tone={model.tone}
        data-state="idle"
        className={cn(meterVariants({ tone: model.tone }), className)}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {label && (
              <div data-slot="meter-header" className="onyx-meter-header">
                <span data-slot="meter-label" id={id}>
                  {label}
                </span>
                <span data-slot="meter-value">
                  {valueText ?? `${Math.round(model.percent)}%`}
                </span>
              </div>
            )}
            <div
              data-slot="meter-track"
              className="onyx-track"
              role="meter"
              aria-labelledby={label ? id : props["aria-labelledby"]}
              aria-label={props["aria-label"]}
              aria-valuemin={model.min}
              aria-valuemax={model.max}
              aria-valuenow={model.value}
              aria-valuetext={valueText}
            >
              <div
                data-slot="meter-indicator"
                className="onyx-meter-indicator"
                style={{ width: `${model.percent}%` }}
              />
            </div>
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Meter.displayName = "Meter";
