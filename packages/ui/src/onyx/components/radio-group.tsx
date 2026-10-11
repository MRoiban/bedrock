/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useResettableState, useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-radio-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useFieldControl } from './field';
const VariantContext = React.createContext<'default' | 'card'>('default');
export const radioGroupVariants = cva('onyx-radio-group', {
  variants: { variant: { default: '', card: 'onyx-radio-cards' } },
  defaultVariants: { variant: 'default' },
});
export const radioGroupItemVariants = cva('onyx-radio-item');
export const radioGroupIndicatorVariants = cva('onyx-radio-indicator');
export interface RadioGroupProps
  extends
    React.ComponentPropsWithoutRef<typeof Primitive.Root>,
    VariantProps<typeof radioGroupVariants> {}
export const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const field = useFieldControl(props);
    props = { ...field, ...props, disabled: props.disabled ?? field.disabled };
    const [value, setValue, reset] = useResettableState({ value: props.value ?? undefined, defaultValue: props.defaultValue ?? '', onChange: props.onValueChange });
    const root = React.useRef<HTMLDivElement>(null);
    const composed = useComposedRefs(ref, root);
    useFormReset(root, reset, props.form);
    return (
      <VariantContext.Provider value={variant ?? 'default'}>
        <Primitive.Root
          ref={composed}
          {...field}
          data-slot="radio-group"
          data-invalid={props['aria-invalid'] && props['aria-invalid'] !== 'false' ? '' : undefined}
          data-variant={variant}
          className={cn(radioGroupVariants({ variant }), className)}
          {...props}
          value={value}
          onValueChange={setValue}
        />
      </VariantContext.Provider>
    );
  },
);
RadioGroup.displayName = 'RadioGroup';
export const RadioGroupItem = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Item>
>(({ className, children, asChild = false, ...props }, ref) => {
  const variant = React.useContext(VariantContext);
  return (
    <Primitive.Item
      ref={ref}
      data-slot="radio-group-item"
      data-variant={variant}
      className={cn(radioGroupItemVariants(), className)}
      asChild={asChild}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          <span data-slot="radio-group-control">
            <Primitive.Indicator
              data-slot="radio-group-indicator"
              className={radioGroupIndicatorVariants()}
            />
          </span>
          {children && <span data-slot="radio-group-label">{children}</span>}
        </>
      )}
    </Primitive.Item>
  );
});
RadioGroupItem.displayName = 'RadioGroupItem';
export const RadioGroupIndicator = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Indicator>
>(({ className, ...props }, ref) => (
  <Primitive.Indicator
    ref={ref}
    data-slot="radio-group-indicator"
    className={cn(radioGroupIndicatorVariants(), className)}
    {...props}
  />
));
RadioGroupIndicator.displayName = 'RadioGroupIndicator';
