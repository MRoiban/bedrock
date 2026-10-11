/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
export const separatorVariants = cva("onyx-separator", {
  variants: { orientation: { horizontal: "onyx-separator--orientation-horizontal", vertical: "onyx-separator--orientation-vertical" }, variant: { line: "onyx-separator--variant-line", label: "onyx-separator--variant-label" } },
  defaultVariants: { orientation: "horizontal", variant: "line" },
});
export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
  label?: string;
}
export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  (
    {
      asChild,
      orientation = "horizontal",
      decorative = true,
      label,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="separator"
        data-orientation={orientation}
        data-variant={label ? "label" : "line"}
        role={decorative ? "presentation" : "separator"}
        aria-orientation={decorative ? undefined : orientation}
        aria-label={decorative ? undefined : label}
        className={cn(separatorVariants({ orientation, variant: label ? "label" : "line" }), className)}
        {...props}
      >
        {asChild ? (
          children
        ) : label ? (
          <span data-slot="separator-label">{label}</span>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Separator.displayName = "Separator";
