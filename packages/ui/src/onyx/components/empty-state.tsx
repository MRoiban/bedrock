/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';

import { cn } from '../lib/cn';

export const EmptyState = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[var(--onyx-radius-lg)] border border-dashed border-[var(--onyx-shell-tabs-border)] bg-[color-mix(in_srgb,var(--onyx-surface-panel)_88%,transparent)] px-6 py-10 text-center',
        className
      )}
      {...props}
    />
  )
);
EmptyState.displayName = 'EmptyState';

export const EmptyStateIcon = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="empty-state-icon"
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full bg-[var(--onyx-state-hover)] text-[var(--onyx-text-muted)]',
        className
      )}
      {...props}
    />
  )
);
EmptyStateIcon.displayName = 'EmptyStateIcon';

export const EmptyStateTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      data-slot="empty-state-title"
      className={cn('text-base font-semibold text-[var(--onyx-text-foreground)]', className)}
      {...props}
    />
  )
);
EmptyStateTitle.displayName = 'EmptyStateTitle';

export const EmptyStateDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    data-slot="empty-state-description"
    className={cn('max-w-md text-sm text-[var(--onyx-text-description)]', className)}
    {...props}
  />
));
EmptyStateDescription.displayName = 'EmptyStateDescription';

export const EmptyStateActions = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="empty-state-actions"
    className={cn('flex items-center gap-2', className)}
    {...props}
  />
));
EmptyStateActions.displayName = 'EmptyStateActions';
