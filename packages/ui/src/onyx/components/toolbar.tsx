/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { Button, type ButtonProps } from './button';
import { cn } from '../lib/cn';

export const toolbarButtonVariants = cva('', {
  variants: {
    tone: {
      default: '',
      active:
        'bg-[var(--onyx-state-selected)] text-[var(--onyx-state-selected-fg)] hover:bg-[var(--onyx-state-selected)]',
      subtle:
        'text-[var(--onyx-text-muted)] hover:text-[var(--onyx-text-foreground)] hover:bg-[var(--onyx-state-hover)]'
    }
  },
  defaultVariants: {
    tone: 'default'
  }
});

export const Toolbar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toolbar"
      role="toolbar"
      className={cn(
        'flex min-h-10 items-center gap-2 border-b border-[var(--onyx-shell-toolbar-border)] bg-[var(--onyx-shell-toolbar-bg)] px-3 py-2',
        className
      )}
      {...props}
    />
  )
);
Toolbar.displayName = 'Toolbar';

export const ToolbarGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toolbar-group"
      className={cn('flex items-center gap-1', className)}
      {...props}
    />
  )
);
ToolbarGroup.displayName = 'ToolbarGroup';

export interface ToolbarButtonProps
  extends Omit<ButtonProps, 'variant'>,
    VariantProps<typeof toolbarButtonVariants> {}

export const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ className, size, tone, ...props }, ref) => (
    <Button
      ref={ref}
      data-slot="toolbar-button"
      variant="ghost"
      size={size ?? 'sm'}
      className={cn(toolbarButtonVariants({ tone }), className)}
      {...props}
    />
  )
);
ToolbarButton.displayName = 'ToolbarButton';

export const ToolbarSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toolbar-separator"
      role="separator"
      className={cn('mx-1 h-5 w-px bg-[var(--onyx-shell-toolbar-border)]', className)}
      {...props}
    />
  )
);
ToolbarSeparator.displayName = 'ToolbarSeparator';
