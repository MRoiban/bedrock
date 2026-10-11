/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';

import { cn } from '../lib/cn';

export type NumberEffectDirection = 'auto' | 'up' | 'down';
export type ResolvedNumberEffectDirection = 'up' | 'down';

export interface NumberEffectProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: number;
  format?: (value: number) => string;
  direction?: NumberEffectDirection;
}

interface NumberEffectTransition {
  id: number;
  previousValue: number;
  direction: ResolvedNumberEffectDirection;
}

export const numberEffectClassName = 'onyx-number-effect';
export const numberEffectSizerClassName = 'onyx-number-effect__sizer';
export const numberEffectViewportClassName = 'onyx-number-effect__viewport';
export const numberEffectValueClassName = 'onyx-number-effect__value';

export function normalizeNumberEffectValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function resolveNumberEffectDirection(
  previousValue: number,
  nextValue: number,
  direction: NumberEffectDirection = 'auto'
): ResolvedNumberEffectDirection {
  if (direction === 'up' || direction === 'down') {
    return direction;
  }

  return nextValue >= previousValue ? 'up' : 'down';
}

export function formatNumberEffectValue(
  value: number,
  format: (value: number) => string = String
): string {
  return format(normalizeNumberEffectValue(value));
}

export const NumberEffect = React.forwardRef<HTMLSpanElement, NumberEffectProps>(
  (
    {
      className,
      value,
      format = String,
      direction = 'auto',
      ...props
    },
    ref
  ) => {
    const currentValue = normalizeNumberEffectValue(value);
    const latestValueRef = React.useRef(currentValue);
    const nextTransitionIdRef = React.useRef(0);
    const [transition, setTransition] = React.useState<NumberEffectTransition | null>(null);

    React.useEffect(() => {
      const previousValue = latestValueRef.current;
      if (Object.is(previousValue, currentValue)) {
        return;
      }

      latestValueRef.current = currentValue;
      setTransition({
        id: nextTransitionIdRef.current + 1,
        previousValue,
        direction: resolveNumberEffectDirection(previousValue, currentValue, direction)
      });
      nextTransitionIdRef.current += 1;
    }, [currentValue, direction]);

    const formattedCurrentValue = formatNumberEffectValue(currentValue, format);
    const formattedPreviousValue = transition
      ? formatNumberEffectValue(transition.previousValue, format)
      : formattedCurrentValue;
    const sizerValue = formattedPreviousValue.length > formattedCurrentValue.length
      ? formattedPreviousValue
      : formattedCurrentValue;
    const ariaLabel = props['aria-label'] ?? formattedCurrentValue;
    const ariaLive = props['aria-live'] ?? 'polite';

    return (
      <span
        ref={ref}
        data-slot="number-effect"
        data-value={formattedCurrentValue}
        data-direction={transition?.direction ?? undefined}
        {...props}
        aria-label={ariaLabel}
        aria-live={ariaLive}
        className={cn(numberEffectClassName, className)}
      >
        <span className={numberEffectSizerClassName} aria-hidden="true">
          {sizerValue}
        </span>
        <span className={numberEffectViewportClassName} aria-hidden="true">
          {transition ? (
            <span
              key={`previous-${transition.id}`}
              className={cn(numberEffectValueClassName, 'onyx-number-effect__value--exit')}
              onAnimationEnd={() => {
                setTransition((currentTransition) =>
                  currentTransition?.id === transition.id ? null : currentTransition
                );
              }}
            >
              {formattedPreviousValue}
            </span>
          ) : null}
          <span
            key={`current-${transition?.id ?? 0}-${formattedCurrentValue}`}
            className={cn(
              numberEffectValueClassName,
              transition
                ? 'onyx-number-effect__value--enter'
                : 'onyx-number-effect__value--static'
            )}
          >
            {formattedCurrentValue}
          </span>
        </span>
      </span>
    );
  }
);
NumberEffect.displayName = 'NumberEffect';
