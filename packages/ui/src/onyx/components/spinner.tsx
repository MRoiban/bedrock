/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';
export const spinnerVariants = cva('onyx-spinner', {
  variants: {
    size: {
      xs: 'onyx-spinner-xs',
      sm: 'onyx-spinner-sm',
      md: 'onyx-spinner-md',
      lg: 'onyx-spinner-lg',
    },
  },
  defaultVariants: { size: 'md' },
});
export interface SpinnerProps
  extends ComponentPropsWithoutRef<'span'>,
    VariantProps<typeof spinnerVariants> {
  asChild?: boolean;
  label?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  (
    {
      asChild = false,
      label = 'Loading',
      size = 'md',
      tone,
      className,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'span';
    return (
      <Comp
        ref={ref}
        role="status"
        aria-label={label}
        data-slot="spinner"
        data-size={size}
        data-tone={tone}
        data-state="loading"
        className={cn(spinnerVariants({ size }), className)}
        {...props}
      />
    );
  },
);
Spinner.displayName = 'Spinner';
