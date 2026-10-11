/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { PortalContainerProvider } from "./popover";
import { useComposedRefs } from "../lib/compose-refs";
import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import * as P from "@radix-ui/react-alert-dialog";
import { Icon } from "./icon";
import { buttonVariants } from "./button";
type AlertDialogTone = "neutral" | "info" | "success" | "warning" | "danger";
const AlertDialogToneContext = React.createContext<AlertDialogTone>("danger");
export const alertDialogVariants = cva("onyx-alert-dialog onyx-modal");
export const AlertDialog = P.Root;
export const AlertDialogPortal = P.Portal;
export const AlertDialogTrigger = React.forwardRef<
  React.ElementRef<typeof P.Trigger>,
  React.ComponentPropsWithoutRef<typeof P.Trigger>
>(({ className, ...props }, ref) => (
  <P.Trigger
    ref={ref}
    data-slot="alert-dialog-trigger"
    className={cn("", className)}
    {...props}
  />
));
AlertDialogTrigger.displayName = "AlertDialogTrigger";
export const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof P.Overlay>,
  React.ComponentPropsWithoutRef<typeof P.Overlay>
>(({ className, ...props }, ref) => (
  <P.Overlay
    ref={ref}
    data-slot="alert-dialog-overlay"
    className={cn("onyx-overlay", className)}
    {...props}
  />
));
AlertDialogOverlay.displayName = "AlertDialogOverlay";
export const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof P.Content>,
  React.ComponentPropsWithoutRef<typeof P.Content> & {
    tone?: "neutral" | "info" | "success" | "warning" | "danger" | undefined;
    container?: HTMLElement | null | undefined;
  }
>(({ className, tone = "danger", container, ...props }, ref) => {
  const [host, setHost] = React.useState<HTMLDivElement | null>(null);
  const contentRef = useComposedRefs(ref, setHost);
  return (
  <PortalContainerProvider value={host}>
  <AlertDialogToneContext.Provider value={tone}>
    <P.Portal container={container}>
      <AlertDialogOverlay />
      <P.Content
        ref={contentRef}
        data-slot="alert-dialog-content"
        data-tone={tone}
        className={cn(alertDialogVariants(), className)}
        {...props}
      />
    </P.Portal>
  </AlertDialogToneContext.Provider>
  </PortalContainerProvider>
  );
});
AlertDialogContent.displayName = "AlertDialogContent";
export const AlertDialogIcon = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    asChild?: boolean | undefined;
    tone?: "neutral" | "info" | "success" | "warning" | "danger" | undefined;
  }
>(({ asChild, className, children, tone: explicitTone, ...props }, ref) => {
  const inheritedTone = React.useContext(AlertDialogToneContext);
  const tone = explicitTone ?? inheritedTone;
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="alert-dialog-icon"
      data-tone={tone}
      className={cn("onyx-alert-dialog-icon", className)}
      {...props}
    >
      {children ?? (
        <Icon
          name={tone === "danger" || tone === "warning" ? "warning" : "info"}
        />
      )}
    </Comp>
  );
});
AlertDialogIcon.displayName = "AlertDialogIcon";
export const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof P.Title>,
  React.ComponentPropsWithoutRef<typeof P.Title>
>(({ className, ...props }, ref) => (
  <P.Title
    ref={ref}
    data-slot="alert-dialog-title"
    className={cn("onyx-overlay-title", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = "AlertDialogTitle";
export const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof P.Description>,
  React.ComponentPropsWithoutRef<typeof P.Description>
>(({ className, ...props }, ref) => (
  <P.Description
    ref={ref}
    data-slot="alert-dialog-description"
    className={cn("onyx-overlay-description", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";
export const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof P.Action>,
  React.ComponentPropsWithoutRef<typeof P.Action>
>(({ className, ...props }, ref) => (
  <P.Action
    ref={ref}
    data-slot="alert-dialog-action"
    className={cn(buttonVariants({ variant: "destructive" }), className)}
    {...props}
  />
));
AlertDialogAction.displayName = "AlertDialogAction";
export const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof P.Cancel>,
  React.ComponentPropsWithoutRef<typeof P.Cancel>
>(({ className, ...props }, ref) => (
  <P.Cancel
    ref={ref}
    data-slot="alert-dialog-cancel"
    className={cn(buttonVariants({ variant: "secondary" }), className)}
    {...props}
  />
));
AlertDialogCancel.displayName = "AlertDialogCancel";
export const AlertDialogHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="alert-dialog-header"
      className={cn("onyx-overlay-header", className)}
      {...props}
    />
  );
});
AlertDialogHeader.displayName = "AlertDialogHeader";
export const AlertDialogBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="alert-dialog-body"
      className={cn("onyx-overlay-body", className)}
      {...props}
    />
  );
});
AlertDialogBody.displayName = "AlertDialogBody";
export const AlertDialogFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="alert-dialog-footer"
      className={cn("onyx-overlay-footer", className)}
      {...props}
    />
  );
});
AlertDialogFooter.displayName = "AlertDialogFooter";
