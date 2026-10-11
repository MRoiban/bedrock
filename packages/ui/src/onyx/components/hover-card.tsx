/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { usePortalContainer } from "./popover";
import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import * as P from "@radix-ui/react-hover-card";
export const HoverCard = P.Root;
export function HoverCardPortal({ container, ...props }: React.ComponentPropsWithoutRef<typeof P.Portal>) {
  const host = usePortalContainer(container);
  return <P.Portal container={host} {...props} />;
}
export const hoverCardVariants = cva("onyx-floating onyx-hover-card");
export const HoverCardTrigger = React.forwardRef<
  React.ElementRef<typeof P.Trigger>,
  React.ComponentPropsWithoutRef<typeof P.Trigger>
>(({ className, ...props }, ref) => (
  <P.Trigger
    ref={ref}
    data-slot="hover-card-trigger"
    className={cn("", className)}
    {...props}
  />
));
HoverCardTrigger.displayName = "HoverCardTrigger";
export const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof P.Content>,
  React.ComponentPropsWithoutRef<typeof P.Content> & {
    container?: HTMLElement | null | undefined;
  }
>(
  (
    { className, container, sideOffset = 8, collisionPadding = 8, ...props },
    ref,
  ) => {
    const portalContainer = usePortalContainer(container);
    return (
    <P.Portal container={portalContainer}>
      <P.Content
        ref={ref}
        data-slot="hover-card-content"
        className={cn(hoverCardVariants(), className)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
      />
    </P.Portal>
    );
  },
);
HoverCardContent.displayName = "HoverCardContent";
export const HoverCardArrow = React.forwardRef<
  React.ElementRef<typeof P.Arrow>,
  React.ComponentPropsWithoutRef<typeof P.Arrow>
>(({ className, ...props }, ref) => (
  <P.Arrow
    ref={ref}
    data-slot="hover-card-arrow"
    className={cn("onyx-floating-arrow", className)}
    {...props}
  />
));
HoverCardArrow.displayName = "HoverCardArrow";
export const HoverCardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="hover-card-header"
      className={cn("onyx-overlay-header", className)}
      {...props}
    />
  );
});
HoverCardHeader.displayName = "HoverCardHeader";
export const HoverCardBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="hover-card-body"
      className={cn("onyx-overlay-body", className)}
      {...props}
    />
  );
});
HoverCardBody.displayName = "HoverCardBody";
export const HoverCardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="hover-card-footer"
      className={cn("onyx-overlay-footer", className)}
      {...props}
    />
  );
});
HoverCardFooter.displayName = "HoverCardFooter";
