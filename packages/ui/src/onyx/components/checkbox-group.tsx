/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useFieldControl } from './field';
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import { Checkbox } from './checkbox';
export const checkboxGroupVariants = cva('onyx-checkbox-group');
export const checkboxGroupItemVariants = cva('onyx-checkbox-group-item');
export const checkboxGroupSelectAllVariants = cva(
  'onyx-checkbox-group-select-all',
);
interface GroupState {
  value: string[];
  setValue: (value: string[]) => void;
  options: string[];
  disabled?: boolean | undefined;
  name?: string | undefined;
  form?: string | undefined;
  register: (value: string, disabled: boolean) => () => void;
}
const Context = React.createContext<GroupState | null>(null);
export function useCheckboxGroup({
  value,
  defaultValue = [],
  onValueChange,
}: {
  value?: string[] | undefined;
  defaultValue?: string[] | undefined;
  onValueChange?: ((value: string[]) => void) | undefined;
} = {}) {
  const [selected, setValue, reset] = useControllableState({
    value,
    defaultValue,
    onChange: onValueChange,
  });
  return {
    value: selected,
    reset,
    setValue,
    toggle: (key: string, checked: boolean) =>
      setValue((v) =>
        checked ? [...new Set([...v, key])] : v.filter((x) => x !== key),
      ),
  };
}
export interface CheckboxGroupProps extends Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'defaultValue'
> {
  asChild?: boolean;
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  options?: string[];
  disabled?: boolean;
  name?: string;
  form?: string;
}
export const CheckboxGroup = React.forwardRef<
  HTMLDivElement,
  CheckboxGroupProps
>(
  (
    {
      value,
      defaultValue,
      onValueChange,
      options: supplied,
      disabled,
      name,
      form,
      asChild,
      className,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    disabled = disabled ?? field.disabled;
    props = { ...field, ...props };
    const state = useCheckboxGroup({ value, defaultValue, onValueChange });
    const resetElement = React.useRef<HTMLDivElement>(null);
    useFormReset(resetElement, state.reset, form);
    const resetRef = useComposedRefs(ref, resetElement);
    const [registered, setRegistered] = React.useState<
      { value: string; disabled: boolean }[]
    >([]);
    const register = React.useCallback((key: string, unavailable: boolean) => {
      setRegistered((v) => [...v, { value: key, disabled: unavailable }]);
      return () => setRegistered((v) => v.filter((x) => x.value !== key));
    }, []);
    const Comp = asChild ? Slot : 'div';
    return (
      <Context.Provider
        value={{
          ...state,
          options:
            supplied ??
            registered.filter((x) => !x.disabled).map((x) => x.value),
          disabled,
          name,
          form,
          register,
        }}
      >
        <Comp
          ref={resetRef}
          role="group"
          data-slot="checkbox-group"
          data-invalid={props['aria-invalid'] && props['aria-invalid'] !== 'false' ? '' : undefined}
          data-disabled={disabled ? '' : undefined}
          className={cn(checkboxGroupVariants(), className)}
          {...props}
        />
      </Context.Provider>
    );
  },
);
CheckboxGroup.displayName = 'CheckboxGroup';
export const CheckboxGroupItem = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentPropsWithoutRef<typeof Checkbox>, 'value'> & {
    value: string;
  }
>(({ value, className, disabled, onChange, ...props }, ref) => {
  const context = React.useContext(Context);
  if (!context) throw new Error('CheckboxGroupItem requires CheckboxGroup');
  React.useLayoutEffect(
    () => context.register(value, !!disabled),
    [context.register, value, disabled],
  );
  const checked = context.value.includes(value);
  return (
    <Checkbox
      ref={ref}
      data-slot="checkbox-group-item"
      data-state={checked ? 'checked' : 'unchecked'}
      data-disabled={disabled ?? context.disabled ? '' : undefined}
      name={context.name}
      form={context.form}
      value={value}
      checked={checked}
      disabled={disabled ?? context.disabled}
      className={cn(checkboxGroupItemVariants(), className)}
      {...props}
      onChange={(e) => {
        onChange?.(e);
        if (!e.defaultPrevented)
          context.setValue(
            e.target.checked
              ? [...new Set([...context.value, value])]
              : context.value.filter((x) => x !== value),
          );
      }}
    />
  );
});
CheckboxGroupItem.displayName = 'CheckboxGroupItem';
export const CheckboxGroupSelectAll = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<typeof Checkbox>
>(({ className, onChange, ...props }, ref) => {
  const context = React.useContext(Context);
  if (!context)
    throw new Error('CheckboxGroupSelectAll requires CheckboxGroup');
  const element = React.useRef<HTMLInputElement>(null);
  const composed = useComposedRefs(ref, element);
  const count = context.options.filter((v) => context.value.includes(v)).length;
  const all = context.options.length > 0 && count === context.options.length;
  const mixed = count > 0 && !all;
  React.useLayoutEffect(() => {
    if (element.current) element.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <Checkbox
      ref={composed}
      checked={all}
      disabled={context.disabled}
      aria-checked={mixed ? 'mixed' : all}
      data-slot="checkbox-group-select-all"
      data-state={mixed ? 'indeterminate' : all ? 'checked' : 'unchecked'}
      className={cn(checkboxGroupSelectAllVariants(), className)}
      {...props}
      onChange={(e) => {
        onChange?.(e);
        if (!e.defaultPrevented)
          context.setValue(
            e.target.checked
              ? [...new Set([...context.value, ...context.options])]
              : context.value.filter((v) => !context.options.includes(v)),
          );
      }}
    />
  );
});
CheckboxGroupSelectAll.displayName = 'CheckboxGroupSelectAll';
