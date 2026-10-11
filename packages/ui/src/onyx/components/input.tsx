/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useFieldControl } from './field';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '../lib/cn';
export const inputVariants = cva(
  'onyx-input flex w-full data-[invalid]:border-[var(--onyx-tone-danger-fg)] aria-[invalid=true]:border-[var(--onyx-tone-danger-fg)] focus-visible:border-[var(--onyx-control-focus-ring)] border border-[var(--onyx-control-input-border)] bg-[var(--onyx-control-input-bg)] text-[var(--onyx-control-input-fg)]',
  {
    variants: {
      size: {
        sm: 'h-[var(--onyx-control-height-sm)] text-[length:var(--onyx-text-sm)]',
        md: 'h-[var(--onyx-input-height,var(--onyx-control-height-md))]',
        lg: 'h-[var(--onyx-control-height-lg)]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);
export interface InputProps
  extends Omit<ComponentPropsWithoutRef<'input'>, 'size'>,
    VariantProps<typeof inputVariants> {
  asChild?: boolean;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { asChild = false, className, type = 'text', size = 'md', ...props },
    ref,
  ) => {
    const field = useFieldControl(props);
    props = { ...field, ...props, disabled: props.disabled ?? field.disabled };
    const Comp = asChild ? Slot : 'input';
    return (
      <Comp
        ref={ref}
        data-slot="input"
        data-size={size}
        data-invalid={
          props['aria-invalid'] && props['aria-invalid'] !== 'false'
            ? ''
            : undefined
        }
        data-disabled={props.disabled ? '' : undefined}
        type={type}
        className={cn(inputVariants({ size }), className)}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
