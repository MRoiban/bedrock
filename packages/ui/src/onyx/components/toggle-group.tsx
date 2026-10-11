/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useFieldControl } from './field';
import { useComposedRefs } from '../lib/compose-refs';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import * as React from 'react';
import * as Primitive from '@radix-ui/react-toggle-group';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { toggleVariants } from './toggle';
export const toggleGroupVariants = cva('onyx-toggle-group');
export const toggleGroupItemVariants = cva('onyx-toggle-group-item');
export type ToggleGroupProps = React.ComponentPropsWithoutRef<
  typeof Primitive.Root
> & { name?: string; form?: string };
export const ToggleGroup = React.forwardRef<HTMLDivElement, ToggleGroupProps>(
  ({ className, name, form, ...props }, ref) => {
    const field = useFieldControl(props);
    props = { ...field, ...props, disabled: props.disabled ?? field.disabled ?? false };
    const [value, setInternal, reset] = useControllableState<string | string[]>({
      value: props.value,
      defaultValue: props.defaultValue ?? (props.type === 'multiple' ? [] : ''),
      onChange: (next) => {
        if (props.type === 'multiple') props.onValueChange?.(next as string[]);
        else props.onValueChange?.(next as string);
      },
    });
    const resetElement = React.useRef<HTMLDivElement>(null);
    useFormReset(resetElement, reset, form);
    const resetRef = useComposedRefs(ref, resetElement);
    const rootProps =
      props.type === 'multiple'
        ? {
            ...props,
            value: value as string[],
            onValueChange: (next: string[]) => {
              setInternal(next);
            },
          }
        : {
            ...props,
            value: value as string,
            onValueChange: (next: string) => {
              setInternal(next);
            },
          };
    return (
      <>
        <Primitive.Root
          ref={resetRef}
          data-slot="toggle-group"
          data-invalid={props['aria-invalid'] && props['aria-invalid'] !== 'false' ? '' : undefined}
          className={cn(toggleGroupVariants(), className)}
          {...rootProps}
        />
        {name &&
          (Array.isArray(value) ? value : value ? [value] : []).map((v) => (
            <input
              data-slot="toggle-group-form-value"
              key={v}
              type="hidden"
              name={name}
              form={form}
              value={v}
              disabled={props.disabled}
            />
          ))}
      </>
    );
  },
);
ToggleGroup.displayName = 'ToggleGroup';
export const ToggleGroupItem = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Item>
>(({ className, ...props }, ref) => (
  <Primitive.Item
    ref={ref}
    data-slot="toggle-group-item"
    className={cn(toggleVariants(), toggleGroupItemVariants(), className)}
    {...props}
  />
));
ToggleGroupItem.displayName = 'ToggleGroupItem';
