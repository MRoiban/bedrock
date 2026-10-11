/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { Icon } from './icon';
interface FieldContextValue {
  id: string;
  required: boolean;
  disabled: boolean;
  invalid: boolean;
  labelIds: string[];
  descriptionIds: string[];
  errorIds: string[];
  register: (kind: 'label' | 'description' | 'error', id: string) => () => void;
}
const FieldContext = React.createContext<FieldContextValue | undefined>(
  undefined,
);
export const fieldVariants = cva('onyx-field');
export const labelVariants = cva('onyx-label');
export const fieldDescriptionVariants = cva('onyx-field-description');
export const fieldErrorVariants = cva('onyx-field-error');
export const fieldsetVariants = cva('onyx-fieldset');
export const legendVariants = cva('onyx-legend');
export interface FieldProps extends React.ComponentPropsWithoutRef<'div'> {
  asChild?: boolean;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}
export const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  (
    {
      id: suppliedId,
      required = false,
      disabled = false,
      invalid = false,
      asChild,
      className,
      ...props
    },
    ref,
  ) => {
    const generated = React.useId();
    const id = suppliedId ?? `onyx-field-${generated}`;
    const [parts, setParts] = React.useState<{
      label: string[];
      description: string[];
      error: string[];
    }>({ label: [], description: [], error: [] });
    const register = React.useCallback(
      (kind: 'label' | 'description' | 'error', partId: string) => {
        setParts((p) => ({ ...p, [kind]: [...p[kind], partId] }));
        return () =>
          setParts((p) => ({
            ...p,
            [kind]: p[kind].filter((x) => x !== partId),
          }));
      },
      [],
    );
    const Comp = asChild ? Slot : 'div';
    return (
      <FieldContext.Provider
        value={{
          id,
          required,
          disabled,
          invalid,
          labelIds: parts.label,
          descriptionIds: parts.description,
          errorIds: parts.error,
          register,
        }}
      >
        <Comp
          ref={ref}
          data-slot="field"
          data-invalid={invalid ? '' : undefined}
          data-disabled={disabled ? '' : undefined}
          data-required={required ? '' : undefined}
          className={cn(fieldVariants(), className)}
          {...props}
        />
      </FieldContext.Provider>
    );
  },
);
Field.displayName = 'Field';
export function useFieldControl(overrides?: Pick<React.AriaAttributes, 'aria-label' | 'aria-labelledby'>) {
  const field = React.useContext(FieldContext);
  return {
    id: field?.id,
    'aria-labelledby': overrides?.['aria-label'] ? undefined : field?.labelIds.join(' ') || undefined,
    'aria-describedby': field
      ? [
          ...field.descriptionIds,
          ...(field.invalid ? field.errorIds : []),
        ].join(' ') || undefined
      : undefined,
    'aria-invalid': field?.invalid || undefined,
    'aria-required': field?.required || undefined,
    disabled: field?.disabled || undefined,
  };
}
export const Label = React.forwardRef<
  HTMLLabelElement,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
    required?: boolean;
    optional?: boolean;
  }
>(({ className, required, optional, children, ...props }, ref) => {
  const field = React.useContext(FieldContext);
  const labelId = usePart('label', props.id);
  return (
    <LabelPrimitive.Root
      id={labelId}
      ref={ref}
      data-slot="field-label"
      htmlFor={field?.id}
      className={cn(labelVariants(), className)}
      {...props}
    >
      {children}
      {(required ?? field?.required) && (
        <span data-slot="field-required" aria-hidden="true">
          *
        </span>
      )}
      {optional && <span data-slot="field-optional">Optional</span>}
    </LabelPrimitive.Root>
  );
});
Label.displayName = 'Label';
function usePart(kind: 'label' | 'description' | 'error', idProp?: string) {
  const field = React.useContext(FieldContext);
  const generated = React.useId();
  const id = idProp ?? `${field?.id ?? generated}-${kind}-${generated}`;
  React.useLayoutEffect(
    () => field?.register(kind, id),
    [field?.register, kind, id],
  );
  return id;
}
export const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<'p'> & { asChild?: boolean }
>(({ asChild, className, id: supplied, ...props }, ref) => {
  const id = usePart('description', supplied);
  const Comp = asChild ? Slot : 'p';
  return (
    <Comp
      ref={ref}
      id={id}
      data-slot="field-description"
      className={cn(fieldDescriptionVariants(), className)}
      {...props}
    />
  );
});
FieldDescription.displayName = 'FieldDescription';
export const FieldError = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<'p'> & { asChild?: boolean }
>(({ asChild, className, id: supplied, children, ...props }, ref) => {
  const id = usePart('error', supplied);
  const Comp = asChild ? Slot : 'p';
  return (
    <Comp
      ref={ref}
      id={id}
      data-slot="field-error"
      aria-live="polite"
      aria-atomic="true"
      className={cn(fieldErrorVariants(), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          <Icon name="error" size="sm" aria-hidden="true" />
          {children}
        </>
      )}
    </Comp>
  );
});
FieldError.displayName = 'FieldError';
export const Fieldset = React.forwardRef<
  HTMLFieldSetElement,
  React.ComponentPropsWithoutRef<'fieldset'> & { asChild?: boolean }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : 'fieldset';
  return (
    <Comp
      ref={ref}
      data-slot="fieldset"
      data-disabled={props.disabled ? '' : undefined}
      className={cn(fieldsetVariants(), className)}
      {...props}
    />
  );
});
Fieldset.displayName = 'Fieldset';
export const Legend = React.forwardRef<
  HTMLLegendElement,
  React.ComponentPropsWithoutRef<'legend'> & { asChild?: boolean }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : 'legend';
  return (
    <Comp
      ref={ref}
      data-slot="fieldset-legend"
      className={cn(legendVariants(), className)}
      {...props}
    />
  );
});
Legend.displayName = 'Legend';
