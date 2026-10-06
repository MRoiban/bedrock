/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';

import { cn } from '../lib/cn';

export const Input = forwardRef<ElementRef<'input'>, ComponentPropsWithoutRef<'input'>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      data-slot="input"
      type={type}
      className={cn(
        'flex h-9 w-full rounded-[var(--onyx-radius-md)] border border-[var(--onyx-control-input-border)] bg-[var(--onyx-control-input-bg)] px-3 py-1 text-sm text-[var(--onyx-control-input-fg)] shadow-[var(--onyx-shadow-sm)] transition-colors placeholder:text-[var(--onyx-text-description)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onyx-control-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
