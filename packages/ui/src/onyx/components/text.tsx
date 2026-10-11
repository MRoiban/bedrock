/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/cn';

export const textVariants = cva('', {
  variants: {
    tone: {
      default: 'text-[var(--onyx-text-foreground)]',
      muted: 'text-[var(--onyx-text-muted)]',
      description: 'text-[var(--onyx-text-description)]',
      link: 'text-[var(--onyx-text-link)]',
    },
  },
  defaultVariants: {
    tone: 'default',
  },
});

export interface TextProps
  extends React.HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof textVariants> {
  asChild?: boolean;
}

export const Text = React.forwardRef<HTMLParagraphElement, TextProps>(
  ({ className, tone, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'p';
    return (
      <Comp
        ref={ref}
        data-slot="text"
        className={cn(
          'text-[length:var(--onyx-text-sm)] leading-[var(--onyx-leading-normal)]',
          textVariants({ tone }),
          className,
        )}
        {...props}
      />
    );
  },
);
Text.displayName = 'Text';

export const Heading = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'h2';
  return (
    <Comp
      ref={ref}
      data-slot="heading"
      className={cn(
        'text-[length:var(--onyx-text-lg)] font-[number:var(--onyx-weight-semibold)] leading-[var(--onyx-leading-tight)] text-[var(--onyx-text-foreground)]',
        className,
      )}
      {...props}
    />
  );
});
Heading.displayName = 'Heading';

export const SectionLabel = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'span';
  return (
    <Comp
      ref={ref}
      data-slot="section-label"
      className={cn(
        'text-[length:var(--onyx-text-xs)] font-[number:var(--onyx-weight-semibold)] leading-[var(--onyx-leading-tight)] text-[var(--onyx-text-description)]',
        className,
      )}
      {...props}
    />
  );
});
SectionLabel.displayName = 'SectionLabel';

export const codeVariants = cva('onyx-code');
export interface CodeProps extends React.ComponentPropsWithoutRef<'code'> {
  asChild?: boolean;
}
export const Code = React.forwardRef<HTMLElement, CodeProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const Comp = asChild ? Slot : 'code';
    return (
      <Comp
        ref={ref}
        data-slot="code"
        className={cn(codeVariants(), className)}
        {...props}
      />
    );
  },
);
Code.displayName = 'Code';
