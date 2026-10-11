/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { Input, type InputProps } from './input';
import { Button, type ButtonProps } from './button';
import { useFieldControl } from './field';
export const inputGroupVariants = cva('onyx-input-group');
export const inputGroupAddonVariants = cva('onyx-input-group-addon');
export const inputGroupInputVariants = cva('onyx-input-group-input');
export const inputGroupButtonVariants = cva('onyx-input-group-button');
export const inputGroupSeparatorVariants = cva('onyx-input-group-separator');
export interface InputGroupProps extends React.ComponentPropsWithoutRef<'div'> {
  asChild?: boolean | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  leading?: React.ReactNode | undefined;
  trailing?: React.ReactNode | undefined;
}
export const InputGroup = React.forwardRef<HTMLDivElement, InputGroupProps>(
  (
    {
      asChild,
      invalid,
      disabled,
      leading,
      trailing,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    const Comp = asChild ? Slot : 'div';
    const isInvalid = invalid ?? props['aria-invalid'] ?? field['aria-invalid'];
    return (
      <Comp
        ref={ref}
        data-slot="input-group"
        data-invalid={isInvalid && isInvalid !== 'false' ? '' : undefined}
        data-disabled={(disabled ?? field.disabled) ? '' : undefined}
        className={cn(inputGroupVariants(), className)}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {leading && <span data-slot="input-group-leading">{leading}</span>}
            {children}
            {trailing && (
              <span data-slot="input-group-trailing">{trailing}</span>
            )}
          </>
        )}
      </Comp>
    );
  },
);
InputGroup.displayName = 'InputGroup';
export const InputGroupAddon = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<'span'> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : 'span';
  return (
    <Comp
      ref={ref}
      data-slot="input-group-addon"
      className={cn(inputGroupAddonVariants(), className)}
      {...props}
    />
  );
});
InputGroupAddon.displayName = 'InputGroupAddon';
export const InputGroupInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      className={cn(
        inputGroupInputVariants(),
        'h-full rounded-none border-0 bg-transparent p-0 shadow-none outline-none focus-visible:shadow-none focus-visible:ring-0',
        className,
      )}
      data-slot="input-group-input"
      {...props}
    />
  ),
);
InputGroupInput.displayName = 'InputGroupInput';
export const InputGroupButton = React.forwardRef<
  HTMLButtonElement,
  ButtonProps
>(({ className, ...props }, ref) => (
  <Button
    ref={ref}
    size="icon-xs"
    variant="ghost"
    data-slot="input-group-button"
    className={cn(inputGroupButtonVariants(), className)}
    {...props}
  />
));
InputGroupButton.displayName = 'InputGroupButton';
export const InputGroupSeparator = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<'span'> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : 'span';
  return (
    <Comp
      ref={ref}
      data-slot="input-group-separator"
      role="separator"
      data-orientation="vertical"
      aria-orientation="vertical"
      className={cn(inputGroupSeparatorVariants(), className)}
      {...props}
    />
  );
});
InputGroupSeparator.displayName = 'InputGroupSeparator';
