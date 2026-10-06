/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';

import { cn } from '../lib/cn';

export const checkboxClassName = [
  'h-4 w-4 shrink-0 appearance-none rounded-[var(--onyx-radius-sm)]',
  'border border-[var(--onyx-control-input-border)] bg-[var(--onyx-control-input-bg)]',
  'text-[var(--onyx-control-button-fg)] transition-colors',
  'checked:border-[var(--onyx-control-button-bg)] checked:bg-[var(--onyx-control-button-bg)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onyx-control-focus-ring)]',
  'disabled:cursor-not-allowed disabled:opacity-50'
].join(' ');

export const Checkbox = forwardRef<
  ElementRef<'input'>,
  Omit<ComponentPropsWithoutRef<'input'>, 'type'>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    data-slot="checkbox"
    className={cn(checkboxClassName, className)}
    {...props}
  />
));
Checkbox.displayName = 'Checkbox';
