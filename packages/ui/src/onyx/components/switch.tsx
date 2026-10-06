/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';

import { cn } from '../lib/cn';

export const switchTrackClassName = [
  'inline-flex h-[calc(20px*var(--onyx-scale-ui))] w-[calc(36px*var(--onyx-scale-ui))] shrink-0 items-center rounded-full border-0 p-[calc(2px*var(--onyx-scale-ui))]',
  'bg-[var(--onyx-control-input-border)] transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onyx-control-focus-ring)]',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'data-[state=checked]:bg-[var(--onyx-control-button-bg)]'
].join(' ');

export const switchThumbClassName = [
  'pointer-events-none block h-[calc(16px*var(--onyx-scale-ui))] w-[calc(16px*var(--onyx-scale-ui))] shrink-0 rounded-full',
  'bg-[var(--onyx-control-button-fg)] shadow-[var(--onyx-shadow-sm)] transition-transform',
  'data-[state=checked]:translate-x-[calc(16px*var(--onyx-scale-ui))] data-[state=unchecked]:translate-x-0'
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
    const [uncontrolledChecked, setUncontrolledChecked] = React.useState(defaultChecked);
    const checked = checkedProp ?? uncontrolledChecked;
    const state = checked ? 'checked' : 'unchecked';

    return (
      <button
        ref={ref}
        type={type}
        role="switch"
        aria-checked={checked}
        data-slot="switch"
        data-state={state}
        disabled={disabled}
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
        {...props}
      >
        <span data-slot="switch-thumb" data-state={state} className={switchThumbClassName} />
      </button>
    );
  }
);
Switch.displayName = 'Switch';
