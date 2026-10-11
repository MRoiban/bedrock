/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useFieldControl } from './field';
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import { hexToHsv, hsvToHex, rgbToHex, type HSV } from '../lib/color';
import { InputGroup, InputGroupInput } from './input-group';
import { ColorSwatch } from './color-swatch';
import { Slider } from './slider';
export {
  hexToRgb,
  rgbToHex,
  rgbToHsv,
  hsvToRgb,
  hexToHsv,
  hsvToHex,
} from '../lib/color';
export type { RGB, HSV } from '../lib/color';
export const colorPickerVariants = cva('onyx-color-picker');
export interface UseColorPickerOptions {
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  alpha?: boolean | undefined;
  disabled?: boolean | undefined;
}
export function useColorPicker({
  value,
  defaultValue = rgbToHex({ r: 32, g: 94, b: 166 }),
  onValueChange,
  alpha,
  disabled,
}: UseColorPickerOptions = {}) {
  const [color, setColor, resetColor] = useControllableState({
    value,
    defaultValue,
    onChange: onValueChange,
  });
  const initialColor = React.useRef(color);
  const [hsv, setHSV] = React.useState<HSV>(() => hexToHsv(color) ?? { h: 0, s: 0, v: 0 });
  React.useLayoutEffect(() => {
    // Preserve latent hue/saturation only when the editable coordinates still
    // represent the accepted colour (black and gray have multiple HSV forms).
    const accepted = hexToHsv(color);
    if (accepted && hsvToHex(hsv, alpha).toLowerCase() !== hsvToHex(accepted, alpha).toLowerCase())
      setHSV(accepted);
  });
  function update(next: Partial<HSV>) {
    if (disabled) return;
    const nextHSV = { ...hsv, ...next, a: alpha ? (next.a ?? hsv.a ?? 1) : undefined };
    const hex = hsvToHex(nextHSV, alpha);
    setHSV(nextHSV);
    // Native slider reset can report the same color in canonical hex casing.
    // Keep latent HSV edits without reporting an unchanged accepted color.
    const accepted = hexToHsv(color);
    if (!accepted || hex !== hsvToHex(accepted, alpha)) setColor(hex);
  }
  return {
    value: color,
    reset: () => { if (value !== undefined) return; resetColor(); setHSV(hexToHsv(initialColor.current) ?? { h: 0, s: 0, v: 0 }); },
    hsv,
    setValue: (hex: string) => {
      if (!disabled && hexToHsv(hex)) {
        const next = hexToHsv(hex)!; setHSV(next);
        setColor(hsvToHex(next, alpha));
      }
    },
    update,
  };
}
export interface ColorPickerProps
  extends
    Omit<React.ComponentPropsWithoutRef<'div'>, 'defaultValue'>,
    UseColorPickerOptions {
  name?: string;
  form?: string;
}
export const ColorPicker = React.forwardRef<HTMLDivElement, ColorPickerProps>(
  (
    {
      value,
      defaultValue,
      onValueChange,
      alpha,
      disabled,
      name,
      form,
      className,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    disabled = disabled ?? field.disabled;
    props = { ...field, ...props };
    const state = useColorPicker({
      value,
      defaultValue,
      onValueChange,
      alpha,
      disabled,
    });
    const resetElement = React.useRef<HTMLDivElement>(null);
    const resetRef = useComposedRefs(ref, resetElement);
    const partId = React.useId();
    const partName = (part: string) => ({
      'aria-labelledby': props['aria-labelledby'] ? `${props['aria-labelledby']} ${partId}-${part.replaceAll(' ', '-')}` : undefined,
      'aria-label': props['aria-label'] ? `${props['aria-label']}, ${part}` : part,
      'aria-describedby': props['aria-describedby'],
      'aria-invalid': props['aria-invalid'],
      'aria-required': props['aria-required'],
    });
    const [draft, setDraft] = React.useState(state.value);
    const initialDraft = React.useRef(state.value);
    useFormReset(resetElement, () => {
      state.reset();
      setDraft(value ?? initialDraft.current);
    }, form);
    React.useEffect(() => setDraft(state.value), [state.value]);
    const applyPoint = (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      state.update({
        s: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
        v: 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
      });
    };
    return (
      <div
        ref={resetRef}
        role="group"
        data-slot="color-picker"
          data-invalid={props['aria-invalid'] && props['aria-invalid'] !== 'false' ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        className={cn(colorPickerVariants(), className)}
        {...props}
      >
        {['Saturation', 'Brightness', 'Hue', 'Opacity', 'Hex color'].map(part => <span key={part} id={`${partId}-${part.replaceAll(' ', '-')}`} hidden>{part}</span>)}
        <div
          data-slot="color-picker-area"
          role="group"
          aria-label="Saturation and brightness"
          aria-describedby={undefined}
          style={
            {
              '--onyx-color-picker-hue': `hsl(${state.hsv.h} 100% 50%)`,
            } as React.CSSProperties
          }
          onPointerDown={(e) => {
            if (disabled) return;
            e.preventDefault();
            e.currentTarget.querySelector<HTMLInputElement>('input')?.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            applyPoint(e);
          }}
          onPointerMove={(e) => {
            if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId))
              applyPoint(e);
          }}
        >
          <span
            data-slot="color-picker-thumb"
            style={{
              left: `${state.hsv.s * 100}%`,
              top: `${(1 - state.hsv.v) * 100}%`,
            }}
          />
          <input
            data-slot="color-picker-saturation"
            className="onyx-color-picker-accessible"
            type="range"
            {...partName('Saturation')}
            min={0}
            max={100}
            value={Math.round(state.hsv.s * 100)}
            disabled={disabled}
            onChange={(e) => state.update({ s: Number(e.target.value) / 100 })}
          />
          <input
            data-slot="color-picker-brightness"
            className="onyx-color-picker-accessible"
            type="range"
            {...partName('Brightness')}
            min={0}
            max={100}
            value={Math.round(state.hsv.v * 100)}
            disabled={disabled}
            onChange={(e) => state.update({ v: Number(e.target.value) / 100 })}
          />
        </div>
        <div data-slot="color-picker-hue">
          <Slider
            {...partName('Hue')}
            disabled={disabled}
            max={360}
            value={[state.hsv.h]}
            onValueChange={([h]) => state.update({ h: h! })}
          />
        </div>
        {alpha && (
          <Slider
            data-slot="color-picker-alpha"
            {...partName('Opacity')}
            disabled={disabled}
            max={100}
            value={[(state.hsv.a ?? 1) * 100]}
            onValueChange={([a]) => state.update({ a: a! / 100 })}
          />
        )}
        <InputGroup>
          <ColorSwatch
            color={state.value}
            tabIndex={-1}
            aria-hidden="true"
            disabled
          />
          <InputGroupInput
            {...partName('Hex color')}
            disabled={disabled}
            value={draft}
            aria-invalid={!hexToHsv(draft) || undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              if (hexToHsv(e.target.value)) state.setValue(e.target.value);
            }}
            onBlur={() => setDraft(state.value)}
          />
        </InputGroup>
        {name && (
          <input
            data-slot="color-picker-form-value"
            type="hidden"
            name={name}
            form={form}
            value={state.value}
            disabled={disabled}
          />
        )}
      </div>
    );
  },
);
ColorPicker.displayName = 'ColorPicker';
