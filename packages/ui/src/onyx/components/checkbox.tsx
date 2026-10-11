/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { useFormReset } from '../lib/use-form-reset';
import { useFieldControl } from './field';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';

import { cn } from '../lib/cn';

export const checkboxClassName = [
  'h-4 w-4 shrink-0 rounded-[var(--onyx-radius-sm)]',
  'border border-[var(--onyx-control-input-border)] bg-[var(--onyx-control-input-bg)]',
  'text-[var(--onyx-control-button-fg)] transition-colors',
  'checked:border-[var(--onyx-control-button-bg)] checked:bg-[var(--onyx-control-button-bg)]',
  'indeterminate:border-[var(--onyx-control-button-bg)] indeterminate:bg-[var(--onyx-control-button-bg)]',
  'data-[state=indeterminate]:border-[var(--onyx-control-button-bg)] data-[state=indeterminate]:bg-[var(--onyx-control-button-bg)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onyx-control-focus-ring)]',
  'disabled:cursor-not-allowed disabled:opacity-50'
].join(' ');

export const Checkbox = forwardRef<
  ElementRef<'input'>,
  Omit<ComponentPropsWithoutRef<'input'>, 'type'>
>(({ className, onChange, ...props }, ref) => {
  const field = useFieldControl(props);
  props = { ...field, ...props, disabled: props.disabled ?? field.disabled };
  const input = React.useRef<HTMLInputElement>(null);
  const [state, setState] = React.useState((props.checked ?? props.defaultChecked) ? 'checked' : 'unchecked');
  const sync = () => {
    const node = input.current;
    if (node) setState(node.indeterminate ? 'indeterminate' : node.checked ? 'checked' : 'unchecked');
  };
  React.useLayoutEffect(() => {
    if (input.current && props['aria-checked'] !== undefined)
      input.current.indeterminate = props['aria-checked'] === 'mixed';
    sync();
  });
  useFormReset(input, () => {
    const node = input.current;
    if (!node) return;
    // Native reset bypasses the checked setter React tracks. Reconcile through
    // that setter so the next click is detected, and retain controlled authority.
    node.checked = props.checked ?? node.checked;
    if (props['aria-checked'] !== undefined)
      node.indeterminate = props['aria-checked'] === 'mixed';
    sync();
  }, props.form);
  return (
    <input
      ref={(node) => {
        input.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      type="checkbox"
      data-state={state}
      data-slot="checkbox"
      data-disabled={props.disabled ? '' : undefined}
      data-invalid={props['aria-invalid'] && props['aria-invalid'] !== 'false' ? '' : undefined}
      className={cn(checkboxClassName, 'onyx-checkbox', className)}
      {...props}
      onChange={(event) => {
        onChange?.(event);
        setState(event.currentTarget.indeterminate ? 'indeterminate' : (props.checked ?? event.currentTarget.checked) ? 'checked' : 'unchecked');
      }}
    />
  );
});
Checkbox.displayName = 'Checkbox';
