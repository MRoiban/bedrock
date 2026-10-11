/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { Slot } from '@radix-ui/react-slot';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  forwardRef,
  useState
} from 'react';

import { cn } from '../lib/cn';
import { useComposedRefs } from '../lib/compose-refs';
import { PortalContainerProvider } from './popover';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = forwardRef<
  ElementRef<typeof DialogPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>((props, ref) => <DialogPrimitive.Trigger ref={ref} data-slot="dialog-trigger" {...props} />);
DialogTrigger.displayName = DialogPrimitive.Trigger.displayName;
export const DialogClose = forwardRef<
  ElementRef<typeof DialogPrimitive.Close>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>((props, ref) => <DialogPrimitive.Close ref={ref} data-slot="dialog-close" {...props} />);
DialogClose.displayName = DialogPrimitive.Close.displayName;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      'fixed inset-0 z-[var(--onyx-z-overlay)] bg-[var(--onyx-surface-overlay)] backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { overlayClassName?: string | undefined }
>(({ className, children, overlayClassName, ...props }, ref) => {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const contentRef = useComposedRefs(ref, setHost);
  return (
  <PortalContainerProvider value={host}>
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={contentRef}
      data-slot="dialog-content"
      className={cn(
        'fixed inset-0 m-auto h-fit max-h-[85vh] overflow-y-auto z-[var(--onyx-z-dialog)] w-full max-w-[min(calc(var(--onyx-dialog-width)*var(--onyx-scale-ui)),calc(100vw-var(--onyx-space-6)*2))] rounded-[calc(var(--onyx-radius-lg)*var(--onyx-scale-ui))] border border-[var(--onyx-border-default)] bg-[var(--onyx-surface-dialog)] p-[calc(var(--onyx-space-6)*var(--onyx-scale-ui))] text-[var(--onyx-text-foreground)] shadow-[var(--onyx-shadow-lg)] outline-none focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 sm:max-w-[min(calc(var(--onyx-dialog-width-lg)*var(--onyx-scale-ui)),calc(100vw-var(--onyx-space-6)*2))]',
        className
      )}
      {...props}
      onFocusOutside={(event) => {
        // Dialogs close on Escape or an outside click, never because focus
        // moved: a context menu that closes as the dialog opens returns focus
        // to its trigger, which would otherwise cancel the dialog instantly
        // (e.g. Delete / Clean Folder confirmations from the Explorer menu).
        props.onFocusOutside?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
  </PortalContainerProvider>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export const DialogHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }>(
  ({ className, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return <Comp ref={ref} data-slot="dialog-header" className={cn('flex flex-col gap-[var(--onyx-space-2)] text-left', className)} {...props} />;
  }
);
DialogHeader.displayName = 'DialogHeader';

export const DialogFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }>(
  ({ className, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return <Comp ref={ref} data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-[var(--onyx-space-2)] sm:flex-row sm:justify-end', className)} {...props} />;
  }
);
DialogFooter.displayName = 'DialogFooter';

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn('text-[length:calc(var(--onyx-text-lg)*var(--onyx-scale-type))] font-[number:var(--onyx-weight-semibold)] leading-[var(--onyx-leading-tight)]', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn('text-[length:calc(var(--onyx-text-md)*var(--onyx-scale-type))] leading-[var(--onyx-leading-normal)] text-[var(--onyx-text-description)]', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
