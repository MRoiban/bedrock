/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
export type DisplayTone = "neutral" | "info" | "success" | "warning" | "danger";
/** Shared tone modifiers use the same CSS rules as data-tone. */
export const displayToneClasses = { neutral: "onyx-display--tone-neutral", info: "onyx-display--tone-info", success: "onyx-display--tone-success", warning: "onyx-display--tone-warning", danger: "onyx-display--tone-danger" };
export const badgeVariants = cva("onyx-badge onyx-display-tone", {
  variants: {
    variant: { subtle: "onyx-badge--variant-subtle", solid: "onyx-badge--variant-solid", outline: "onyx-badge--variant-outline" },
    tone: displayToneClasses,
  },
  defaultVariants: { variant: "subtle", tone: "neutral" },
});
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  asChild?: boolean;
  tone?: DisplayTone;
  variant?: "subtle" | "solid" | "outline";
  icon?: React.ReactNode;
}
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      asChild,
      tone = "neutral",
      variant = "subtle",
      icon,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "span";
    return (
      <Comp
        ref={ref}
        data-slot="badge"
        data-tone={tone}
        data-variant={variant}
        className={cn(badgeVariants({ tone, variant }), className)}
        {...props}
      >
        {icon && <span data-slot="badge-icon">{icon}</span>}
        <Slottable>{children}</Slottable>
      </Comp>
    );
  },
);
Badge.displayName = "Badge";
export const countVariants = cva("onyx-count onyx-display-tone", {
  variants: { tone: displayToneClasses, variant: { subtle: "onyx-count--variant-subtle", solid: "onyx-count--variant-solid", outline: "onyx-count--variant-outline" } },
  defaultVariants: { tone: "info", variant: "solid" },
});
export interface CountProps extends Omit<BadgeProps, "children" | "icon"> {
  value: number;
  max?: number;
  children?: React.ReactElement;
}
function normalizeCount(value: number, max: number) {
  return {
    value: Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0)),
    max: Number.isFinite(max) && Math.trunc(max) >= 1 ? Math.trunc(max) : Infinity,
  };
}
function countText({ value, max }: ReturnType<typeof normalizeCount>) {
  return value > max ? `${max}+` : String(value);
}
export function formatCount(value: number, max = 99) {
  return countText(normalizeCount(value, max));
}
/** Optional styling attributes and integration hooks for custom display markup. */
export function displayAttributes(options: {
  tone?: DisplayTone | undefined;
  variant?: string | undefined;
  size?: string | undefined;
  state?: string | undefined;
  orientation?: "horizontal" | "vertical" | undefined;
  interactive?: boolean | undefined;
  pulse?: boolean | undefined;
} = {}) {
  return {
    "data-tone": options.tone,
    "data-variant": options.variant,
    "data-size": options.size,
    "data-state": options.state,
    "data-orientation": options.orientation,
    "data-interactive": options.interactive || undefined,
    "data-pulse": options.pulse || undefined,
  };
}
export function badgeAttributes({ tone = "neutral", variant = "subtle" }: Pick<BadgeProps, "tone" | "variant"> = {}) {
  return displayAttributes({ tone, variant });
}
export const Count = React.forwardRef<HTMLSpanElement, CountProps>(
  (
    {
      value,
      max = 99,
      tone = "info",
      variant = "solid",
      className,
      asChild,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "span";
    const normalized = normalizeCount(value, max);
    const content = countText(normalized);
    return (
      <Comp
        ref={ref}
        data-slot="count"
        data-tone={tone}
        data-variant={variant}
        aria-label={String(normalized.value)}
        className={cn(countVariants({ tone, variant }), className)}
        {...props}
      >
        {asChild && children
          ? React.cloneElement(
              children as React.ReactElement<{ children?: React.ReactNode | undefined }>,
              {},
              content,
            )
          : content}
      </Comp>
    );
  },
);
Count.displayName = "Count";
export const statusDotVariants = cva("onyx-status-dot onyx-display-tone", {
  variants: { tone: displayToneClasses, pulse: { true: "onyx-status-dot--pulse", false: "" } },
  defaultVariants: { tone: "neutral", pulse: false },
});
export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  asChild?: boolean;
  tone?: DisplayTone;
  pulse?: boolean;
  label?: string;
}
export const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ asChild, tone = "neutral", pulse, label, className, ...props }, ref) => {
    const Comp = asChild ? Slot : "span";
    return (
      <Comp
        ref={ref}
        data-slot="status-dot"
        data-tone={tone}
        data-state={pulse ? "pulsing" : "idle"}
        data-pulse={pulse || undefined}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={cn(
          statusDotVariants({ tone, pulse }),
          pulse && "animate-onyx-pulse motion-reduce:animate-none",
          className,
        )}
        {...props}
      />
    );
  },
);
StatusDot.displayName = "StatusDot";
