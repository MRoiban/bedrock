/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import { useFieldControl } from './field';
export const otpFieldVariants = cva('onyx-otp-field');
export interface UseOTPFieldOptions {
  length?: number | undefined;
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  onComplete?: ((value: string) => void) | undefined;
  pattern?: RegExp | undefined;
  disabled?: boolean | undefined;
}
export function useOTPField({
  length = 6,
  value,
  defaultValue = '',
  onValueChange,
  onComplete,
  pattern = /[0-9]/,
  disabled,
}: UseOTPFieldOptions = {}) {
  const [code, setCode, reset] = useControllableState({
    value,
    defaultValue,
    onChange: onValueChange,
  });
  const composing = React.useRef(new Set<number>());
  const inputs = React.useRef<(HTMLInputElement | null)[]>([]);
  const clean = (text: string) =>
    Array.from(text)
      .filter((c) => {
        pattern.lastIndex = 0;
        return pattern.test(c);
      })
      .join('');
  const update = (next: string) => {
    setCode(next);
    if (next.length === length && !next.includes(' ')) onComplete?.(next);
  };
  function distribute(index: number, text: string) {
    if (disabled) return;
    const insertion = clean(text).slice(0, length - index);
    if (!insertion) return;
    const chars = code.padEnd(length, ' ').split('');
    chars.splice(index, insertion.length, ...insertion);
    update(chars.join('').trimEnd());
    inputs.current[Math.min(index + insertion.length, length - 1)]?.focus();
  }
  function getCellProps(index: number) {
    return {
      value: code[index]?.trim() ?? '',
      disabled,
      inputMode: 'numeric' as const,
      autoComplete: index === 0 ? 'one-time-code' : 'off',
      'aria-label': `Digit ${index + 1} of ${length}`,
      onFocus: (e: React.FocusEvent<HTMLInputElement>) =>
        e.currentTarget.select(),
      onCompositionStart: () => { composing.current.add(index); },
      onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement>) => {
        composing.current.delete(index); distribute(index, e.currentTarget.value);
      },
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        if (composing.current.has(index) || (e.nativeEvent as InputEvent).isComposing) return;
        if (e.target.value) distribute(index, e.target.value);
        else {
          const chars = code.split('');
          chars[index] = ' ';
          update(chars.join('').trimEnd());
        }
      },
      onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        distribute(index, e.clipboardData.getData('text'));
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (disabled || composing.current.has(index) || e.nativeEvent.isComposing) return;
        if (e.key === 'Backspace') {
          e.preventDefault();
          const target = code[index]?.trim() ? index : Math.max(0, index - 1);
          const chars = code.split('');
          chars[target] = ' ';
          update(chars.join('').trimEnd());
          inputs.current[target]?.focus();
        } else if (e.key === 'Delete') {
          e.preventDefault();
          const chars = code.split('');
          chars[index] = ' ';
          update(chars.join('').trimEnd());
        } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          inputs.current[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? length - 1
                : Math.max(
                    0,
                    Math.min(
                      length - 1,
                      index + (e.key === 'ArrowLeft' ? -1 : 1),
                    ),
                  )
          ]?.focus();
        }
      },
    };
  }
  return { value: code, reset, setValue: update, inputs, distribute, getCellProps };
}
export interface OTPFieldProps
  extends
    Omit<React.ComponentPropsWithoutRef<'div'>, 'defaultValue' | 'onChange'>,
    UseOTPFieldOptions {
  separatorAfter?: number[];
  separator?: React.ReactNode;
  name?: string;
  form?: string;
  autoFocus?: boolean;
}
export const OTPField = React.forwardRef<HTMLDivElement, OTPFieldProps>(
  (
    {
      length = 6,
      value,
      defaultValue,
      onValueChange,
      onComplete,
      pattern,
      disabled: supplied,
      separatorAfter = [3],
      separator = '–',
      name,
      form,
      autoFocus,
      className,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    const disabled = supplied ?? field.disabled;
    props = { ...field, ...props };
    const positionId = React.useId();
    const state = useOTPField({
      length,
      value,
      defaultValue,
      onValueChange,
      onComplete,
      pattern,
      disabled,
    });
    const resetElement = React.useRef<HTMLDivElement>(null);
    useFormReset(resetElement, state.reset, form);
    const resetRef = useComposedRefs(ref, resetElement);
    return (
      <div
        ref={resetRef}
        role="group"
        data-slot="otp-field"
        data-disabled={disabled ? '' : undefined}
        data-invalid={props['aria-invalid'] && props['aria-invalid'] !== 'false' ? '' : undefined}
        className={cn(otpFieldVariants(), className)}
        {...props}
        id={`${positionId}-group`}
      >
        {Array.from({ length }, (_, i) => (
          <React.Fragment key={i}>
            {i > 0 && separatorAfter.includes(i) && (
              <span data-slot="otp-field-separator" aria-hidden="true">
                {separator}
              </span>
            )}
            <span id={`${positionId}-${i}`} hidden>{`digit ${i + 1} of ${length}`}</span>
            <input
              {...field}
              id={i === 0 ? props.id : undefined}
              ref={(node) => {
                state.inputs.current[i] = node;
              }}
              data-slot="otp-field-cell"
              data-state={state.value[i]?.trim() ? 'filled' : 'empty'}
              {...state.getCellProps(i)}
              form={form}
              aria-labelledby={props['aria-labelledby'] ? `${props['aria-labelledby']} ${positionId}-${i}` : undefined}
              aria-label={props['aria-label'] ? `${props['aria-label']}, digit ${i + 1} of ${length}` : `Digit ${i + 1} of ${length}`}
              aria-describedby={props['aria-describedby']}
              aria-invalid={props['aria-invalid']}
              aria-required={props['aria-required']}
              autoFocus={
                autoFocus && i === Math.min(state.value.length, length - 1)
              }
            />
          </React.Fragment>
        ))}
        {name && (
          <input
            data-slot="otp-field-form-value"
            type="hidden"
            name={name}
            form={form}
            disabled={disabled}
            value={state.value.replace(/ /g, '')}
          />
        )}
      </div>
    );
  },
);
OTPField.displayName = 'OTPField';
