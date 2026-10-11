/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

export const statusBarItemVariants = cva(
  'inline-flex min-h-7 items-center gap-2 rounded-[var(--onyx-radius-sm)] px-2 py-1 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'text-[var(--onyx-shell-status-bar-fg)] hover:bg-[var(--onyx-state-hover)]',
        active: 'bg-[var(--onyx-state-active)] text-[var(--onyx-shell-status-bar-fg)]',
        warning: 'text-[var(--onyx-state-warning)] hover:bg-[var(--onyx-state-hover)]',
        error: 'text-[var(--onyx-state-error)] hover:bg-[var(--onyx-state-hover)]',
        success: 'text-[var(--onyx-state-success)] hover:bg-[var(--onyx-state-hover)]'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export const StatusBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { size?: 'sm' | 'md' | undefined }>(
  ({ className, size = 'md', ...props }, ref) => (
    <footer
      ref={ref}
      data-slot="status-bar"
      data-size={size}
      className={cn(
        'flex items-center gap-1 bg-[var(--onyx-shell-status-bar-bg)] text-[var(--onyx-shell-status-bar-fg)]',
        size === 'sm' ? 'min-h-0 px-1' : 'min-h-8 px-2',
        className
      )}
      {...props}
    />
  )
);
StatusBar.displayName = 'StatusBar';

export const StatusBarGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} data-slot="status-bar-group" className={cn('flex min-w-0 items-center gap-1', className)} {...props} />
);
StatusBarGroup.displayName = 'StatusBarGroup';

export interface StatusBarItemProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusBarItemVariants> {}

export const StatusBarItem = React.forwardRef<HTMLDivElement, StatusBarItemProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="status-bar-item"
      className={cn(statusBarItemVariants({ variant }), className)}
      {...props}
    />
  )
);
StatusBarItem.displayName = 'StatusBarItem';

export const StatusBarSpacer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="status-bar-spacer" className={cn('flex-1', className)} {...props} />
  )
);
StatusBarSpacer.displayName = 'StatusBarSpacer';
