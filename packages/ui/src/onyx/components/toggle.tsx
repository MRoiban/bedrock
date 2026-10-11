/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useFieldControl } from './field';
import { useComposedRefs } from '../lib/compose-refs';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
export const toggleVariants = cva('onyx-toggle', {
  variants: {
    size: { sm: 'onyx-toggle-sm', md: 'onyx-toggle-md' },
    variant: { default: '', outline: 'onyx-toggle-outline' },
  },
  defaultVariants: { size: 'sm', variant: 'default' },
});
export interface ToggleProps
  extends
    React.ComponentPropsWithoutRef<typeof Primitive.Root>,
    VariantProps<typeof toggleVariants> {
  name?: string;
  form?: string;
  value?: string;
}
export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  (
    {
      className,
      size = 'sm',
      variant = 'default',
      name,
      form,
      value = 'on',
      pressed,
      defaultPressed,
      onPressedChange,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    props = { ...field, ...props, disabled: props.disabled ?? field.disabled };
    const [active, setActive, reset] = useControllableState({
      value: pressed,
      defaultValue: defaultPressed ?? false,
      onChange: onPressedChange,
    });
    const resetElement = React.useRef<HTMLButtonElement>(null);
    useFormReset(resetElement, reset, form);
    const resetRef = useComposedRefs(ref, resetElement);
    return (
      <>
        <Primitive.Root
          ref={resetRef}
          data-slot="toggle"
          data-invalid={props['aria-invalid'] && props['aria-invalid'] !== 'false' ? '' : undefined}
          data-size={size}
          data-variant={variant}
          className={cn(toggleVariants({ size, variant }), className)}
          pressed={active}
          onPressedChange={setActive}
          {...props}
        />
        {name && active && (
          <input
            data-slot="toggle-form-value"
            type="hidden"
            name={name}
            form={form}
            value={value}
            disabled={props.disabled}
          />
        )}
      </>
    );
  },
);
Toggle.displayName = 'Toggle';
