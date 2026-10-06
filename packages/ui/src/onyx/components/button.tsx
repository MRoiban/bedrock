/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';

import { cn } from '../lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--onyx-radius-md)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onyx-control-focus-ring)] focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--onyx-control-button-bg)] text-[var(--onyx-control-button-fg)] hover:bg-[var(--onyx-control-button-hover-bg)]',
        destructive:
          'bg-[var(--onyx-control-destructive-bg)] text-[var(--onyx-control-destructive-fg)] hover:brightness-110',
        secondary:
          'bg-[var(--onyx-control-secondary-bg)] text-[var(--onyx-control-secondary-fg)] hover:bg-[var(--onyx-control-secondary-hover-bg)]',
        outline:
          'border border-[var(--onyx-shell-tabs-border)] bg-transparent text-[var(--onyx-text-foreground)] hover:bg-[var(--onyx-state-hover)]',
        ghost:
          'bg-transparent text-[var(--onyx-text-foreground)] hover:bg-[var(--onyx-state-hover)]',
        link: 'px-0 text-[var(--onyx-text-link)] underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-5',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

export interface ButtonProps
  extends ComponentPropsWithoutRef<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<ElementRef<'button'>, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ size, variant }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
