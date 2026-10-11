/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { InputGroup, InputGroupInput, InputGroupButton } from './input-group';
import { Icon } from './icon';
import { type InputProps } from './input';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import { useFieldControl } from './field';
export const passwordFieldVariants = cva('onyx-password-field');
export interface PasswordFieldProps extends InputProps {
  revealed?: boolean | undefined;
  defaultRevealed?: boolean | undefined;
  onRevealedChange?: ((revealed: boolean) => void) | undefined;
}
export function usePasswordField({
  revealed,
  defaultRevealed = false,
  onRevealedChange,
}: Pick<
  PasswordFieldProps,
  'revealed' | 'defaultRevealed' | 'onRevealedChange'
> = {}) {
  const [visible, setVisible, reset] = useControllableState({
    value: revealed,
    defaultValue: defaultRevealed,
    onChange: onRevealedChange,
  });
  return {
    reset,
    revealed: visible,
    setRevealed: setVisible,
    toggle: () => setVisible((v) => !v),
  };
}
export const PasswordField = React.forwardRef<
  HTMLInputElement,
  PasswordFieldProps
>(
  (
    {
      className,
      revealed,
      defaultRevealed = false,
      onRevealedChange,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    props = { ...field, ...props, disabled: props.disabled ?? field.disabled };
    const { revealed: visible, setRevealed: setVisible, reset } = usePasswordField({
      revealed,
      defaultRevealed,
      onRevealedChange,
    });
    const input = React.useRef<HTMLInputElement>(null);
    const composed = useComposedRefs(ref, input);
    useFormReset(input, reset, props.form);
    return (
      <InputGroup
        data-slot="password-field"
        disabled={props.disabled}
        className={cn(passwordFieldVariants(), className)}
        leading={<Icon name="key" size="sm" />}
        trailing={
          <InputGroupButton
            disabled={props.disabled}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setVisible(!visible)}
          >
            <Icon name={visible ? 'eye-closed' : 'eye'} size="sm" />
          </InputGroupButton>
        }
      >
        <InputGroupInput
          ref={composed}
          autoComplete="current-password"
          {...props}
          type={visible ? 'text' : 'password'}
        />
      </InputGroup>
    );
  },
);
PasswordField.displayName = 'PasswordField';
