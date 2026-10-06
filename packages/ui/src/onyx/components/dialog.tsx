/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  forwardRef
} from 'react';

import { cn } from '../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
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
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-slot="dialog-content"
      className={cn(
        'fixed inset-0 m-auto h-fit max-h-[85vh] overflow-y-auto z-[var(--onyx-z-dialog)] w-full max-w-[min(calc(512px*var(--onyx-scale-ui)),calc(100vw-48px))] rounded-[calc(var(--onyx-radius-lg)*var(--onyx-scale-ui))] border border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-surface-dialog)] p-[calc(24px*var(--onyx-scale-ui))] text-[var(--onyx-text-foreground)] shadow-[var(--onyx-shadow-lg)] outline-none focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 sm:max-w-[min(calc(576px*var(--onyx-scale-ui)),calc(100vw-48px))]',
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
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export const DialogHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-header"
    className={cn('flex flex-col space-y-[calc(8px*var(--onyx-scale-ui))] text-left', className)}
    {...props}
  />
);

export const DialogFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-footer"
    className={cn('flex flex-col-reverse gap-[calc(8px*var(--onyx-scale-ui))] sm:flex-row sm:justify-end', className)}
    {...props}
  />
);

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn('text-[length:calc(16px*var(--onyx-scale-ui))] font-semibold leading-[1]', className)}
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
    className={cn('text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-text-description)]', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
