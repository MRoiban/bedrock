/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

export const textVariants = cva('', {
  variants: {
    tone: {
      default: 'text-[var(--onyx-text-foreground)]',
      muted: 'text-[var(--onyx-text-muted)]',
      description: 'text-[var(--onyx-text-description)]',
      link: 'text-[var(--onyx-text-link)]'
    }
  },
  defaultVariants: {
    tone: 'default'
  }
});

export interface TextProps
  extends React.HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof textVariants> {}

export const Text = React.forwardRef<HTMLParagraphElement, TextProps>(
  ({ className, tone, ...props }, ref) => (
    <p
      ref={ref}
      data-slot="text"
      className={cn('text-sm', textVariants({ tone }), className)}
      {...props}
    />
  )
);
Text.displayName = 'Text';

export const Heading = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      data-slot="heading"
      className={cn('text-lg font-semibold text-[var(--onyx-text-foreground)]', className)}
      {...props}
    />
  )
);
Heading.displayName = 'Heading';

export const SectionLabel = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="section-label"
    className={cn(
      'text-xs font-semibold text-[var(--onyx-text-description)]',
      className
    )}
    {...props}
  />
));
SectionLabel.displayName = 'SectionLabel';
