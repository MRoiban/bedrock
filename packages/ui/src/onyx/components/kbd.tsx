/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';

import { cn } from '../lib/cn';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {}

export const Kbd = React.forwardRef<HTMLElement, KbdProps>(({ className, ...props }, ref) => (
  <kbd
    ref={ref}
    data-slot="kbd"
    className={cn(
      'inline-flex min-h-[max(16px,calc(20px*var(--onyx-scale-ui)))] items-center justify-center rounded-[calc(var(--onyx-radius-sm)*var(--onyx-scale-ui))] border border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-surface-panel)] px-[calc(6px*var(--onyx-scale-ui))] py-[calc(2px*var(--onyx-scale-ui))] text-[length:calc(10px*var(--onyx-scale-ui))] font-semibold leading-none text-[var(--onyx-text-muted)] shadow-[inset_0_-1px_0_rgba(16,15,15,0.25)]',
      className
    )}
    {...props}
  />
));
Kbd.displayName = 'Kbd';
