/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import { InputGroup, InputGroupInput, InputGroupButton } from './input-group';
import { Icon } from './icon';
import { useFieldControl } from './field';
import { type InputProps } from './input';
export const searchFieldVariants = cva('onyx-search-field');
export interface SearchFieldProps extends Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange'
> {
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  onChange?: React.ChangeEventHandler<HTMLInputElement> | undefined;
  toggles?: React.ReactNode | undefined;
  clearable?: boolean | undefined;
}
export function useSearchField({
  value,
  defaultValue = '',
  onValueChange,
}: Pick<SearchFieldProps, 'value' | 'defaultValue' | 'onValueChange'> = {}) {
  const [text, setText, reset] = useControllableState({
    value,
    defaultValue,
    onChange: onValueChange,
  });
  const clear = () => setText('');
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && text) {
      event.preventDefault();
      clear();
    }
  };
  return { value: text, reset, setValue: setText, clear, onKeyDown };
}
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  (
    {
      value,
      defaultValue = '',
      onValueChange,
      toggles,
      clearable = true,
      className,
      onKeyDown,
      onChange,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    props = { ...field, ...props, disabled: props.disabled ?? field.disabled };
    const { value: text, reset, setValue: setText } = useSearchField({
      value,
      defaultValue,
      onValueChange,
    });
    const input = React.useRef<HTMLInputElement>(null);
    useFormReset(input, reset, props.form);
    return (
      <InputGroup
        data-slot="search-field"
        className={cn(searchFieldVariants(), className)}
        disabled={props.disabled}
        invalid={
          props['aria-invalid'] === undefined
            ? undefined
            : props['aria-invalid'] !== false &&
              props['aria-invalid'] !== 'false'
        }
        leading={<Icon name="search" size="sm" />}
        trailing={
          <>
            {toggles}
            {clearable && text && (
              <InputGroupButton
                aria-label="Clear search"
                disabled={props.disabled || props.readOnly}
                onClick={() => {
                  if (props.disabled || props.readOnly) return;
                  setText('');
                  input.current?.focus();
                }}
              >
                <Icon name="close" size="sm" />
              </InputGroupButton>
            )}
          </>
        }
      >
        <InputGroupInput
          {...props}
          ref={(node) => {
            input.current = node;
            if (typeof ref === 'function') return ref(node);
            if (ref) ref.current = node;
          }}
          type="search"
          value={text}
          onChange={(e) => {
            onChange?.(e);
            if (!e.defaultPrevented) setText(e.target.value);
          }}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (!e.defaultPrevented && !props.disabled && !props.readOnly && e.key === 'Escape' && text) {
              e.preventDefault();
              setText('');
            }
          }}
        />
      </InputGroup>
    );
  },
);
SearchField.displayName = 'SearchField';
