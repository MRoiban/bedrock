/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import { useFieldControl } from './field';
import * as React from 'react';

import { cn } from '../lib/cn';

export const switchTrackClassName = [
  'onyx-switch inline-flex shrink-0 items-center rounded-full border-0',
  'bg-[var(--onyx-control-input-border)] transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onyx-control-focus-ring)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'data-[state=checked]:bg-[var(--onyx-control-button-bg)]'
].join(' ');

export const switchThumbClassName = [
  'onyx-switch-thumb pointer-events-none block shrink-0 rounded-full',
  'bg-[var(--onyx-control-button-fg)] shadow-[var(--onyx-shadow-sm)] transition-transform',
  ''
].join(' ');

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked: checkedProp,
      className,
      defaultChecked = false,
      disabled,
      onCheckedChange,
      onClick,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const field = useFieldControl(props);
    disabled = disabled ?? field.disabled;
    const controlProps = { ...field, ...props, disabled };
    const [uncontrolledChecked, setUncontrolledChecked] = React.useState(defaultChecked);
    const checked = checkedProp ?? uncontrolledChecked;
    const initialChecked = React.useRef(defaultChecked);
    const input = React.useRef<HTMLButtonElement>(null);
    const composed = useComposedRefs(ref, input);
    useFormReset(input, () => { if (checkedProp === undefined) setUncontrolledChecked(initialChecked.current); }, props.form);
    const state = checked ? 'checked' : 'unchecked';

    return (
      <button
        ref={composed}
        type={type}
        role="switch"
        aria-checked={checked}
        data-slot="switch"
        data-disabled={disabled ? '' : undefined}
        data-invalid={controlProps['aria-invalid'] && controlProps['aria-invalid'] !== 'false' ? '' : undefined}
        data-state={state}
        className={cn(switchTrackClassName, className)}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || disabled) {
            return;
          }

          const nextChecked = !checked;
          if (checkedProp === undefined) {
            setUncontrolledChecked(nextChecked);
          }
          onCheckedChange?.(nextChecked);
        }}
        {...controlProps}
      >
        <span data-slot="switch-thumb" data-state={state} className={switchThumbClassName} />
      </button>
    );
  }
);
Switch.displayName = 'Switch';
