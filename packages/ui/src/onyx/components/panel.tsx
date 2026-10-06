/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';

import { cn } from '../lib/cn';

export const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <section
      ref={ref}
      data-slot="panel"
      className={cn(
        'flex min-h-0 flex-col rounded-[var(--onyx-radius-lg)] border border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-surface-panel)] text-[var(--onyx-text-foreground)] shadow-[var(--onyx-shadow-sm)]',
        className
      )}
      {...props}
    />
  )
);
Panel.displayName = 'Panel';

export const PanelHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <header
      ref={ref}
      data-slot="panel-header"
      className={cn(
        'flex items-center gap-3 border-b border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-shell-toolbar-bg)] px-4 py-3',
        className
      )}
      {...props}
    />
  )
);
PanelHeader.displayName = 'PanelHeader';

export const PanelBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="panel-body"
      className={cn('min-h-0 flex-1 px-4 py-3', className)}
      {...props}
    />
  )
);
PanelBody.displayName = 'PanelBody';

export const PanelFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <footer
      ref={ref}
      data-slot="panel-footer"
      className={cn(
        'flex items-center gap-3 border-t border-[var(--onyx-shell-tabs-border)] px-4 py-3',
        className
      )}
      {...props}
    />
  )
);
PanelFooter.displayName = 'PanelFooter';

export const ListRow = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="list-row"
      className={cn(
        'flex min-h-9 items-center gap-2 rounded-[var(--onyx-radius-sm)] px-3 text-sm text-[var(--onyx-text-foreground)] transition-colors hover:bg-[var(--onyx-state-hover)] data-[state=active]:bg-[var(--onyx-state-selected)] data-[state=active]:text-[var(--onyx-state-selected-fg)]',
        className
      )}
      {...props}
    />
  )
);
ListRow.displayName = 'ListRow';

export const TreeRow = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <ListRow ref={ref} data-slot="tree-row" className={cn('font-normal', className)} {...props} />
  )
);
TreeRow.displayName = 'TreeRow';
