/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import * as P from "@radix-ui/react-popover";
/** Floating children inherit the nearest modal content as their portal host. */
const PortalContainerContext = React.createContext<HTMLElement | null>(null);
export const PortalContainerProvider = PortalContainerContext.Provider;
export function usePortalContainer(container?: Element | DocumentFragment | null) {
  const inherited = React.useContext(PortalContainerContext);
  return container === undefined ? inherited : container;
}
export const Popover = P.Root;
export function PopoverPortal({ container, ...props }: React.ComponentPropsWithoutRef<typeof P.Portal>) {
  const host = usePortalContainer(container);
  return <P.Portal container={host} {...props} />;
}
export const popoverVariants = cva("onyx-floating onyx-popover");
export const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof P.Trigger>,
  React.ComponentPropsWithoutRef<typeof P.Trigger>
>(({ className, ...props }, ref) => (
  <P.Trigger
    ref={ref}
    data-slot="popover-trigger"
    className={cn("", className)}
    {...props}
  />
));
PopoverTrigger.displayName = "PopoverTrigger";
export const PopoverAnchor = React.forwardRef<
  React.ElementRef<typeof P.Anchor>,
  React.ComponentPropsWithoutRef<typeof P.Anchor>
>(({ className, ...props }, ref) => (
  <P.Anchor
    ref={ref}
    data-slot="popover-anchor"
    className={cn("", className)}
    {...props}
  />
));
PopoverAnchor.displayName = "PopoverAnchor";
export const PopoverClose = React.forwardRef<
  React.ElementRef<typeof P.Close>,
  React.ComponentPropsWithoutRef<typeof P.Close>
>(({ className, ...props }, ref) => (
  <P.Close
    ref={ref}
    data-slot="popover-close"
    className={cn("", className)}
    {...props}
  />
));
PopoverClose.displayName = "PopoverClose";
export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof P.Content>,
  React.ComponentPropsWithoutRef<typeof P.Content> & {
    container?: HTMLElement | null | undefined;
  }
>(
  (
    { className, container, children, sideOffset = 8, collisionPadding = 8, ...props },
    ref,
  ) => {
    const portalContainer = usePortalContainer(container);
    return (
    <P.Portal container={portalContainer}>
      <P.Content
        ref={ref}
        data-slot="popover-content"
        className={cn(popoverVariants(), className)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
        style={{ ...(props.asChild ? { overflow: "auto" } : {}), ...props.style }}
      >
        {props.asChild ? children : <>
          {React.Children.toArray(children).filter(child => React.isValidElement(child) && child.type === PopoverArrow)}
          <div data-slot="popover-scroll" className="onyx-popover-scroll">
            {React.Children.toArray(children).filter(child => !React.isValidElement(child) || child.type !== PopoverArrow)}
          </div>
        </>}
      </P.Content>
    </P.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";
export const PopoverArrow = React.forwardRef<
  React.ElementRef<typeof P.Arrow>,
  React.ComponentPropsWithoutRef<typeof P.Arrow>
>(({ className, ...props }, ref) => (
  <P.Arrow
    ref={ref}
    data-slot="popover-arrow"
    className={cn("onyx-floating-arrow", className)}
    {...props}
  />
));
PopoverArrow.displayName = "PopoverArrow";
export const PopoverHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="popover-header"
      className={cn("onyx-overlay-header", className)}
      {...props}
    />
  );
});
PopoverHeader.displayName = "PopoverHeader";
export const PopoverBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="popover-body"
      className={cn("onyx-overlay-body", className)}
      {...props}
    />
  );
});
PopoverBody.displayName = "PopoverBody";
export const PopoverFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="popover-footer"
      className={cn("onyx-overlay-footer", className)}
      {...props}
    />
  );
});
PopoverFooter.displayName = "PopoverFooter";
