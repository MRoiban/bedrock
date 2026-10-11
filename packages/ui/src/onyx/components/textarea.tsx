/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useFieldControl } from './field';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '../lib/cn';
export const textareaClassName =
  'onyx-textarea flex w-full data-[invalid]:border-[var(--onyx-tone-danger-fg)] aria-[invalid=true]:border-[var(--onyx-tone-danger-fg)] focus-visible:border-[var(--onyx-control-focus-ring)] border border-[var(--onyx-control-input-border)] bg-[var(--onyx-control-input-bg)] text-[var(--onyx-control-input-fg)]';
export const textareaVariants = cva(textareaClassName, {
  variants: {
    size: {
      sm: 'text-[length:var(--onyx-text-sm)]',
      md: 'text-[length:var(--onyx-text-md)]',
      lg: 'text-[length:var(--onyx-text-lg)]',
    },
  },
  defaultVariants: { size: 'md' },
});
export interface TextareaProps
  extends ComponentPropsWithoutRef<'textarea'>,
    VariantProps<typeof textareaVariants> {
  asChild?: boolean;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ asChild = false, className, size = 'md', ...props }, ref) => {
    const field = useFieldControl(props);
    props = { ...field, ...props, disabled: props.disabled ?? field.disabled };
    const Comp = asChild ? Slot : 'textarea';
    return (
      <Comp
        ref={ref}
        data-slot="textarea"
        data-size={size}
        data-invalid={
          props['aria-invalid'] && props['aria-invalid'] !== 'false'
            ? ''
            : undefined
        }
        data-disabled={props.disabled ? '' : undefined}
        className={cn(textareaVariants({ size }), className)}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
