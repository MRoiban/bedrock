/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import * as Primitive from '@radix-ui/react-slider';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import { useFieldControl } from './field';
const SliderARIA = React.createContext<React.AriaAttributes>({});
export const sliderVariants = cva('onyx-slider');
export const sliderTrackVariants = cva('onyx-slider-track');
export const sliderRangeVariants = cva('onyx-slider-range');
export const sliderThumbVariants = cva('onyx-slider-thumb');
export interface SliderProps extends Omit<React.ComponentPropsWithoutRef<
  typeof Primitive.Root
>, 'disabled'> {
  disabled?: boolean | undefined;
  marks?: (number | { value: number; label: React.ReactNode })[] | undefined;
  showValue?: boolean | undefined;
  formatValue?: ((value: number) => string) | undefined;
  thumbLabels?: string[] | undefined;
}
export const Slider = React.forwardRef<HTMLSpanElement, SliderProps>(
  (
    {
      className,
      value,
      defaultValue = [0],
      onValueChange,
      marks,
      showValue,
      formatValue = String,
      thumbLabels,
      min = 0,
      max = 100,
      children,
      ...props
    },
    ref,
  ) => {
    const thumbId = React.useId();
    const field = useFieldControl(props);
    props = { ...field, ...props, disabled: props.disabled ?? field.disabled ?? false };
    const [values, setValues, reset] = useControllableState({
      value,
      defaultValue,
      onChange: onValueChange,
    });
    const root = React.useRef<HTMLSpanElement>(null);
    const composed = useComposedRefs(ref, root);
    useFormReset(root, reset, props.form);
    return (
      <SliderARIA.Provider value={{ 'aria-label': props['aria-label'], 'aria-labelledby': props['aria-labelledby'], 'aria-describedby': props['aria-describedby'], 'aria-invalid': props['aria-invalid'], 'aria-required': props['aria-required'] }}>
      <div data-slot="slider-container">
        {showValue && (
          <output data-slot="slider-value">
            {values.map(formatValue).join(' – ')}
          </output>
        )}
        <Primitive.Root
          ref={composed}
          data-slot="slider"
          data-invalid={props['aria-invalid'] && props['aria-invalid'] !== 'false' ? '' : undefined}
          className={cn(sliderVariants(), className)}
          value={values}
          onValueChange={setValues}
          min={min}
          max={max}
          {...props}
          disabled={props.disabled ?? false}
        >
          {children ?? (
            <>
              <Primitive.Track
                data-slot="slider-track"
                className={sliderTrackVariants()}
              >
                <Primitive.Range
                  data-slot="slider-range"
                  className={sliderRangeVariants()}
                />
              </Primitive.Track>
              {values.map((_, i) => (
                <React.Fragment key={i}>
                {thumbLabels?.[i] && <span id={`${thumbId}-${i}`} hidden>{thumbLabels[i]}</span>}
                <Primitive.Thumb
                  key={i}
                  aria-labelledby={thumbLabels?.[i] ? [props['aria-labelledby'], `${thumbId}-${i}`].filter(Boolean).join(' ') : props['aria-labelledby']}
                  aria-describedby={props['aria-describedby']}
                  aria-invalid={props['aria-invalid']}
                  aria-required={props['aria-required']}
                  data-slot="slider-thumb"
                  className={sliderThumbVariants()}
                  aria-label={
                    thumbLabels?.[i] ??
                    props['aria-label'] ??
                    (values.length > 1
                      ? i === 0
                        ? 'Minimum'
                        : 'Maximum'
                      : undefined)
                  }
                  aria-valuetext={formatValue(values[i]!)}
                />
                </React.Fragment>
              ))}
            </>
          )}
        </Primitive.Root>
        {marks && (
          <div data-slot="slider-marks">
            {marks.map((mark) => {
              const n = typeof mark === 'number' ? mark : mark.value;
              return (
                <span
                  key={n}
                  data-slot="slider-mark"
                  style={{ left: `${((n - min) / (max - min)) * 100}%` }}
                >
                  {typeof mark === 'number' ? formatValue(mark) : mark.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
      </SliderARIA.Provider>
    );
  },
);
Slider.displayName = 'Slider';
export const SliderTrack = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Track>
>(({ className, ...props }, ref) => (
  <Primitive.Track
    ref={ref}
    data-slot="slider-track"
    className={cn(sliderTrackVariants(), className)}
    {...props}
  />
));
export const SliderRange = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Range>
>(({ className, ...props }, ref) => (
  <Primitive.Range
    ref={ref}
    data-slot="slider-range"
    className={cn(sliderRangeVariants(), className)}
    {...props}
  />
));
export const SliderThumb = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Thumb>
>(({ className, ...props }, ref) => {
  const control = React.useContext(SliderARIA);
  return (
  <Primitive.Thumb
    {...control}
    ref={ref}
    data-slot="slider-thumb"
    className={cn(sliderThumbVariants(), className)}
    {...props}
  />
  );
});
