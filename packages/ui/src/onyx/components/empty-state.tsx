/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { displayToneClasses, type DisplayTone } from "./badge";
import { cn } from "../lib/cn";

export const emptyStateVariants = cva("onyx-empty-state onyx-display-tone", {
  variants: { tone: displayToneClasses, size: { sm: "onyx-empty-state--size-sm", md: "onyx-empty-state--size-md", lg: "onyx-empty-state--size-lg" } },
  defaultVariants: { tone: "neutral", size: "md" },
});
export const emptyStateIconVariants = cva("onyx-empty-state-icon");
export const emptyStateTitleVariants = cva("onyx-empty-state-title");
export const emptyStateDescriptionVariants = cva(
  "onyx-empty-state-description",
);
export const emptyStateActionsVariants = cva("onyx-empty-state-actions");
export const EmptyState = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    asChild?: boolean;
    tone?: DisplayTone;
    size?: "sm" | "md" | "lg";
  }
>(({ className, asChild, tone = "neutral", size = "md", ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="empty-state"
      data-tone={tone}
      data-size={size}
      className={cn(emptyStateVariants({ tone, size }), className)}
      {...props}
    />
  );
});
EmptyState.displayName = "EmptyState";

export const EmptyStateIcon = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="empty-state-icon"
      className={cn("onyx-empty-state-icon", className)}
      {...props}
    />
  );
});
EmptyStateIcon.displayName = "EmptyStateIcon";

export const EmptyStateTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "h3";
  return (
    <Comp
      ref={ref}
      data-slot="empty-state-title"
      className={cn("onyx-empty-state-title", className)}
      {...props}
    />
  );
});
EmptyStateTitle.displayName = "EmptyStateTitle";

export const EmptyStateDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "p";
  return (
    <Comp
      ref={ref}
      data-slot="empty-state-description"
      className={cn("onyx-empty-state-description", className)}
      {...props}
    />
  );
});
EmptyStateDescription.displayName = "EmptyStateDescription";

export const EmptyStateActions = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="empty-state-actions"
      className={cn("onyx-empty-state-actions", className)}
      {...props}
    />
  );
});
EmptyStateActions.displayName = "EmptyStateActions";
