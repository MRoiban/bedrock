/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { PortalContainerProvider } from "./popover";
import { useComposedRefs } from "../lib/compose-refs";
import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import * as P from "@radix-ui/react-dialog";
export const sheetVariants = cva("onyx-sheet");
export const Sheet = P.Root;
export const SheetPortal = P.Portal;
export const SheetTrigger = React.forwardRef<
  React.ElementRef<typeof P.Trigger>,
  React.ComponentPropsWithoutRef<typeof P.Trigger>
>(({ className, ...props }, ref) => (
  <P.Trigger
    ref={ref}
    data-slot="sheet-trigger"
    className={cn("onyx-overlay-trigger", className)}
    {...props}
  />
));
SheetTrigger.displayName = "SheetTrigger";
export const SheetClose = React.forwardRef<
  React.ElementRef<typeof P.Close>,
  React.ComponentPropsWithoutRef<typeof P.Close>
>(({ className, ...props }, ref) => (
  <P.Close
    ref={ref}
    data-slot="sheet-close"
    className={cn("onyx-overlay-close", className)}
    {...props}
  />
));
SheetClose.displayName = "SheetClose";
export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof P.Title>,
  React.ComponentPropsWithoutRef<typeof P.Title>
>(({ className, ...props }, ref) => (
  <P.Title
    ref={ref}
    data-slot="sheet-title"
    className={cn("onyx-overlay-title", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";
export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof P.Description>,
  React.ComponentPropsWithoutRef<typeof P.Description>
>(({ className, ...props }, ref) => (
  <P.Description
    ref={ref}
    data-slot="sheet-description"
    className={cn("onyx-overlay-description", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";
export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof P.Overlay>,
  React.ComponentPropsWithoutRef<typeof P.Overlay>
>(({ className, ...props }, ref) => (
  <P.Overlay
    ref={ref}
    data-slot="sheet-overlay"
    className={cn("onyx-overlay", className)}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof P.Content>,
  React.ComponentPropsWithoutRef<typeof P.Content> & {
    side?: "left" | "right" | "top" | "bottom" | undefined;
    container?: HTMLElement | null | undefined;
  }
>(({ className, side = "right", children, container, ...props }, ref) => {
  const [host, setHost] = React.useState<HTMLDivElement | null>(null);
  const contentRef = useComposedRefs(ref, setHost);
  return (
  <PortalContainerProvider value={host}>
  <P.Portal container={container}>
    <SheetOverlay />
    <P.Content
      ref={contentRef}
      data-slot="sheet-content"
      data-side={side}
      className={cn(sheetVariants(), className)}
      {...props}
    >
      {props.asChild && React.isValidElement(children) ? (
        React.cloneElement(
          children as React.ReactElement<{ children?: React.ReactNode | undefined }>,
          {},
          <>
            {side === "bottom" && <SheetHandle />}
            {(children.props as { children?: React.ReactNode | undefined }).children}
          </>,
        )
      ) : (
        <>
          {side === "bottom" && <SheetHandle />}
          {children}
        </>
      )}
    </P.Content>
  </P.Portal>
  </PortalContainerProvider>
  );
});
SheetContent.displayName = "SheetContent";
export const SheetHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="sheet-header"
      className={cn("onyx-sheet-header", className)}
      {...props}
    />
  );
});
SheetHeader.displayName = "SheetHeader";
export const SheetBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="sheet-body"
      className={cn("onyx-sheet-body", className)}
      {...props}
    />
  );
});
SheetBody.displayName = "SheetBody";
export const SheetFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="sheet-footer"
      className={cn("onyx-sheet-footer", className)}
      {...props}
    />
  );
});
SheetFooter.displayName = "SheetFooter";
export const SheetHandle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="sheet-handle"
      className={cn("onyx-sheet-handle", className)}
      {...props}
    />
  );
});
SheetHandle.displayName = "SheetHandle";
