/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useFieldControl } from './field';
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import { useRovingFocus } from '../lib/use-roving-focus';
import { useComposedRefs } from '../lib/compose-refs';
export const colorSwatchVariants = cva('onyx-color-swatch');
export const colorSwatchGroupVariants = cva('onyx-color-swatch-group');
const Context = React.createContext<{
  value: string;
  setValue: (value: string) => void;
  disabled?: boolean | undefined;
} | null>(null);
export interface ColorSwatchProps extends React.ComponentPropsWithoutRef<'button'> {
  asChild?: boolean;
  color: string;
  selected?: boolean;
}
export const ColorSwatch = React.forwardRef<
  HTMLButtonElement,
  ColorSwatchProps
>(
  (
    { asChild, color, selected, disabled, className, style, onClick, ...props },
    ref,
  ) => {
    const context = React.useContext(Context);
    const active = selected ?? context?.value === color;
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type="button"
        role={context ? 'radio' : undefined}
        aria-checked={context ? active : undefined}
        aria-label={color}
        disabled={disabled ?? context?.disabled}
        data-disabled={disabled ?? context?.disabled ? '' : undefined}
        data-slot="color-swatch"
          data-invalid={props['aria-invalid'] && props['aria-invalid'] !== 'false' ? '' : undefined}
        data-state={active ? 'selected' : 'unselected'}
        data-selected={active ? '' : undefined}
        className={cn(colorSwatchVariants(), className)}
        style={{ background: color, ...style }}
        {...props}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          if (!e.defaultPrevented) context?.setValue(color);
        }}
      />
    );
  },
);
ColorSwatch.displayName = 'ColorSwatch';
export interface ColorSwatchGroupProps extends Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'defaultValue'
> {
  asChild?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
  form?: string;
}
export const ColorSwatchGroup = React.forwardRef<
  HTMLDivElement,
  ColorSwatchGroupProps
>(
  (
    {
      asChild,
      value,
      defaultValue = '',
      onValueChange,
      disabled,
      name,
      form,
      className,
      onKeyDown,
      onFocusCapture,
      children,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    disabled = disabled ?? field.disabled;
    props = { ...field, ...props };
    const [selected, setValue, reset] = useControllableState({
      value,
      defaultValue,
      onChange: onValueChange,
    });
    const resetElement = React.useRef<HTMLDivElement>(null);
    useFormReset(resetElement, reset, form);
    const resetRef = useComposedRefs(ref, resetElement);
    const roving = useRovingFocus({
      orientation: 'both',
      selector: '[data-slot="color-swatch"]',
    });
    const composed = useComposedRefs(resetRef, roving.ref);
    const Comp = asChild ? Slot : 'div';
    return (
      <Context.Provider value={{ value: selected, setValue, disabled }}>
        <Comp
          ref={composed}
          role="radiogroup"
          data-slot="color-swatch-group"
          data-disabled={disabled ? '' : undefined}
          className={cn(colorSwatchGroupVariants(), className)}
          {...props}
          onFocusCapture={(e: React.FocusEvent<HTMLDivElement>) => {
            onFocusCapture?.(e);
            if (!e.defaultPrevented) roving.onFocusCapture(e);
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            roving.onKeyDown(e);
            if (
              [
                'ArrowLeft',
                'ArrowRight',
                'ArrowUp',
                'ArrowDown',
                'Home',
                'End',
              ].includes(e.key)
            )
              (document.activeElement as HTMLButtonElement)?.click();
          }}
        >
          {children}
        </Comp>
        {name && (
          <input
            data-slot="color-swatch-form-value"
            type="hidden"
            name={name}
            form={form}
            value={selected}
            disabled={disabled}
          />
        )}
      </Context.Provider>
    );
  },
);
ColorSwatchGroup.displayName = 'ColorSwatchGroup';
