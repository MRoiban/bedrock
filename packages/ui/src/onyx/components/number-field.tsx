/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import { useFieldControl } from './field';
import { Icon } from './icon';
export const numberFieldVariants = cva('onyx-number-field');
export interface UseNumberFieldOptions {
  value?: number | undefined;
  defaultValue?: number | undefined;
  onValueChange?: ((value: number) => void) | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  locale?: string | undefined;
  formatOptions?: Intl.NumberFormatOptions | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  wheel?: boolean | undefined;
}
export function useNumberField({
  value: controlled,
  defaultValue = 0,
  onValueChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  locale,
  formatOptions,
  disabled,
  readOnly,
  wheel = false,
}: UseNumberFieldOptions = {}) {
  const increment = Number.isFinite(step) && step > 0 ? step : 1;
  const clamp = (n: number) =>
    Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0));
  const snap = (n: number) =>
    clamp(
      Number(
        (
          Math.round((n - (Number.isFinite(min) ? min : 0)) / increment) *
            increment +
          (Number.isFinite(min) ? min : 0)
        ).toPrecision(12),
      ),
    );
  const [value, setValue, resetValue] = useControllableState({
    value: controlled,
    defaultValue: snap(defaultValue),
    onChange: onValueChange,
  });
  const initialValue = React.useRef(value);
  const formatter = new Intl.NumberFormat(locale, formatOptions);
  const format = (n: number) => formatter.format(n);
  function parse(text: string) {
    const parts = new Intl.NumberFormat(locale, { style: 'decimal', minimumFractionDigits: 1 }).formatToParts(-12345.6);
    const group = parts.find((p) => p.type === 'group')?.value;
    const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
    const minus = parts.find((p) => p.type === 'minusSign')?.value ?? '-';
    let normalized = text;
    const digitFormat = new Intl.NumberFormat(locale, { useGrouping: false });
    for (let i = 0; i < 10; i++)
      normalized = normalized.split(digitFormat.format(i)).join(String(i));
    if (group) normalized = normalized.split(group).join('');
    normalized = normalized
      .split(decimal)
      .join('.')
      .split(minus)
      .join('-')
      .replace(/[^\d.+-]/g, '');
    if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized))
      return NaN;
    const n = Number(normalized);
    return formatOptions?.style === 'percent' ? n / 100 : n;
  }
  const [text, setDraftText] = React.useState(format(value));
  const localDraft = React.useRef(false);
  const setText = (next: string) => { localDraft.current = true; setDraftText(next); };
  React.useLayoutEffect(() => {
    if (localDraft.current) { localDraft.current = false; return; }
    if (controlled !== undefined) setDraftText(format(controlled));
  });
  React.useEffect(
    () => setText(format(value)),
    [value, locale, JSON.stringify(formatOptions)],
  );
  const change = (n: number) => {
    if (disabled || readOnly) return;
    const next = snap(n);
    setValue(next);
    setText(format(controlled === undefined ? next : controlled));
  };
  const commit = () => {
    const parsed = parse(text);
    if (Number.isFinite(parsed)) change(parsed);
    else setText(format(value));
  };
  const adjust = (n: number) => {
    const parsed = parse(text);
    change((Number.isFinite(parsed) ? parsed : value) + n * increment);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled || readOnly) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
      e.preventDefault();
      adjust(
        e.key === 'ArrowUp'
          ? 1
          : e.key === 'ArrowDown'
            ? -1
            : e.key === 'PageUp'
              ? 10
              : -10,
      );
    } else if (e.key === 'Home' && Number.isFinite(min)) {
      e.preventDefault();
      change(min);
    } else if (e.key === 'End' && Number.isFinite(max)) {
      e.preventDefault();
      change(max);
    } else if (e.key === 'Enter') commit();
  };
  return {
    value,
    reset: () => { resetValue(); setText(format(controlled ?? initialValue.current)); },
    text,
    setText,
    setValue: change,
    increment: () => adjust(1),
    decrement: () => adjust(-1),
    commit,
    parse,
    format,
    inputProps: {
      role: 'spinbutton' as const,
      inputMode: 'decimal' as const,
      value: text,
      disabled,
      readOnly,
      'aria-valuenow': Number.isFinite(parse(text)) ? parse(text) : undefined,
      'aria-valuetext': Number.isFinite(parse(text)) ? text : text.trim() ? `Invalid number: ${text}` : 'Empty',
      'aria-valuemin': Number.isFinite(min) ? min : undefined,
      'aria-valuemax': Number.isFinite(max) ? max : undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setText(e.target.value),
      onBlur: commit,
      onKeyDown,
      onWheel: (e: React.WheelEvent<HTMLInputElement>) => {
        if (
          wheel &&
          e.currentTarget === document.activeElement &&
          !disabled &&
          !readOnly &&
          e.deltaY
        ) {
          e.preventDefault();
          adjust(e.deltaY < 0 ? 1 : -1);
        }
      },
    },
  };
}
export interface NumberFieldProps
  extends
    Omit<
      React.ComponentPropsWithoutRef<'input'>,
      'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step'
    >,
    UseNumberFieldOptions {
  unit?: React.ReactNode;
  /** Root element ref; the legacy forwarded ref remains the input ref. */
  rootRef?: React.Ref<HTMLDivElement>;
  inputRef?: React.Ref<HTMLInputElement>;
  inputProps?: React.ComponentPropsWithoutRef<'input'>;
}
export const NumberField = React.forwardRef<HTMLInputElement, NumberFieldProps>(
  (
    {
      value,
      defaultValue,
      onValueChange,
      min,
      max,
      step,
      locale,
      formatOptions,
      disabled: suppliedDisabled,
      readOnly,
      wheel,
      unit,
      className,
      style,
      rootRef,
      inputRef,
      inputProps,
      name,
      form,
      onKeyDown,
      onBlur,
      onWheel,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    const disabled = suppliedDisabled ?? field.disabled;
    const state = useNumberField({
      value,
      defaultValue,
      onValueChange,
      min,
      max,
      step,
      locale,
      formatOptions,
      disabled,
      readOnly,
      wheel,
    });
    const resetElement = React.useRef<HTMLDivElement>(null);
    useFormReset(resetElement, state.reset, form);
    const composedRoot = useComposedRefs(rootRef, resetElement);
    const composedInput = useComposedRefs(ref, inputRef);
    const invalid = props['aria-invalid'] ?? field['aria-invalid'];
    return (
      <div
        ref={composedRoot}
        style={style}
        data-slot="number-field"
        data-disabled={disabled ? '' : undefined}
        data-invalid={
          invalid && invalid !== 'false' ? '' : undefined
        }
        className={cn(numberFieldVariants(), className)}
      >
        <input
          {...field}
          {...props}
          {...state.inputProps}
          {...inputProps}
          form={form}
          ref={composedInput}
          data-slot="number-field-input"
          type="text"
          onChange={(e) => {
            inputProps?.onChange?.(e);
            if (!e.defaultPrevented) state.inputProps.onChange(e);
          }}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            inputProps?.onKeyDown?.(e);
            if (!e.defaultPrevented) state.inputProps.onKeyDown(e);
          }}
          onBlur={(e) => {
            onBlur?.(e);
            inputProps?.onBlur?.(e);
            if (!e.defaultPrevented) state.commit();
          }}
          onWheel={(e) => {
            onWheel?.(e);
            inputProps?.onWheel?.(e);
            if (!e.defaultPrevented) state.inputProps.onWheel(e);
          }}
        />
        {unit && <span data-slot="number-field-unit">{unit}</span>}
        <span data-slot="number-field-steppers">
          <button
            type="button"
            data-slot="number-field-increment"
            aria-label="Increase value"
            tabIndex={-1}
            disabled={
              disabled || readOnly || (max !== undefined && state.value >= max)
            }
            onMouseDown={(e) => e.preventDefault()}
            onClick={state.increment}
          >
            <Icon name="chevron-up" size="sm" />
          </button>
          <button
            type="button"
            data-slot="number-field-decrement"
            aria-label="Decrease value"
            tabIndex={-1}
            disabled={
              disabled || readOnly || (min !== undefined && state.value <= min)
            }
            onMouseDown={(e) => e.preventDefault()}
            onClick={state.decrement}
          >
            <Icon name="chevron-down" size="sm" />
          </button>
        </span>
        {name && (
          <input
            data-slot="number-field-form-value"
            type="hidden"
            name={name}
            form={form}
            disabled={disabled}
            value={state.value}
          />
        )}
      </div>
    );
  },
);
NumberField.displayName = 'NumberField';
