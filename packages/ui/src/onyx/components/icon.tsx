/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';

import { cn } from '../lib/cn';

const iconVariants = cva('codicon inline-flex shrink-0 items-center justify-center', {
  variants: {
    size: {
      xs: 'text-xs',
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl'
    }
  },
  defaultVariants: {
    size: 'md'
  }
});

export interface IconProps
  extends Omit<ComponentPropsWithoutRef<'i'>, 'children'>,
    VariantProps<typeof iconVariants> {
  name: string;
  decorative?: boolean;
  label?: string;
}

export function normalizeCodiconName(name: string): string {
  return name.replace(/^codicon-/, '');
}

export const Icon = forwardRef<HTMLElement, IconProps>(
  ({ className, decorative = true, label, name, size, ...props }, ref) => (
    <i
      ref={ref}
      data-slot="icon"
      className={cn(iconVariants({ size }), `codicon-${normalizeCodiconName(name)}`, className)}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : label}
      role={decorative ? undefined : 'img'}
      {...props}
    />
  )
);
Icon.displayName = 'Icon';
