/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { useFieldControl } from './field';
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { useResettableState as useControllableState, useFormReset } from '../lib/use-form-reset';
import { useComposedRefs } from '../lib/compose-refs';
import { Icon } from './icon';

export type DateRange = { from?: Date; to?: Date };
export type CalendarValue = Date | DateRange | undefined;
export interface UseCalendarOptions {
  mode?: 'single' | 'range' | undefined;
  value?: CalendarValue | undefined;
  defaultValue?: CalendarValue | undefined;
  onValueChange?: ((value: CalendarValue) => void) | undefined;
  defaultMonth?: Date | undefined;
  min?: Date | undefined;
  max?: Date | undefined;
  locale?: string | undefined;
  weekStartsOn?: number | undefined;
  disabled?: boolean | ((date: Date) => boolean) | undefined;
}
export const calendarVariants = cva('onyx-calendar');
const day = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());
const equal = (a?: Date, b?: Date) => !!a && !!b && +day(a) === +day(b);
const addDays = (date: Date, n: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
function addMonths(date: Date, n: number) {
  const next = new Date(date.getFullYear(), date.getMonth() + n, 1);
  next.setDate(
    Math.min(
      date.getDate(),
      new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(),
    ),
  );
  return next;
}
export function getWeekStartsOn(locale = 'en-US') {
  const loc = new Intl.Locale(locale) as Intl.Locale & {
    weekInfo?: { firstDay: number } | undefined;
    getWeekInfo?: (() => { firstDay: number }) | undefined;
  };
  return (loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay ?? 1) % 7;
}
export function useCalendar({
  mode = 'single',
  value: controlled,
  defaultValue,
  onValueChange,
  defaultMonth,
  min,
  max,
  locale = 'en-US',
  weekStartsOn,
  disabled,
}: UseCalendarOptions = {}) {
  const [value, setValue, reset] = useControllableState<CalendarValue>({
    value: controlled,
    defaultValue,
    onChange: onValueChange,
  });
  const selected = value instanceof Date ? value : value?.from;
  const candidate = day(selected ?? defaultMonth ?? new Date());
  const initial =
    min && +candidate < +day(min)
      ? day(min)
      : max && +candidate > +day(max)
        ? day(max)
        : candidate;
  const resetDate = React.useRef(initial);
  const [month, setMonth] = React.useState(
    new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const [focusedDate, setFocusedDate] = React.useState(initial);
  const startOfWeek = (((weekStartsOn ?? getWeekStartsOn(locale)) % 7) + 7) % 7;
  const isDisabled = (date: Date) =>
    disabled === true ||
    (!!min && +day(date) < +day(min)) ||
    (!!max && +day(date) > +day(max)) ||
    (typeof disabled === 'function' && disabled(date));
  const isSelected = (date: Date) =>
    value instanceof Date
      ? equal(value, date)
      : equal(value?.from, date) || equal(value?.to, date);
  const isInRange = (date: Date) =>
    !(value instanceof Date) &&
    !!value?.from &&
    !!value?.to &&
    +day(date) > +day(value.from) &&
    +day(date) < +day(value.to);
  function select(date: Date) {
    if (isDisabled(date)) return;
    navigate(date);
    if (mode === 'single') setValue(day(date));
    else {
      const range = value instanceof Date ? undefined : value;
      if (!range?.from || range.to) setValue({ from: day(date) });
      else {
        const from = +date < +range.from ? day(date) : range.from;
        const to = +date < +range.from ? range.from : day(date);
        // A range cannot cross a disabled date.
        for (let d = from; +d <= +to; d = addDays(d, 1))
          if (isDisabled(d)) return;
        setValue({ from, to });
      }
    }
  }
  function navigate(date: Date) {
    const bounded =
      min && +day(date) < +day(min)
        ? day(min)
        : max && +day(date) > +day(max)
          ? day(max)
          : date;
    setFocusedDate(bounded);
    setMonth(new Date(bounded.getFullYear(), bounded.getMonth(), 1));
  }
  function onKeyDown(event: React.KeyboardEvent, date = focusedDate) {
    const delta = (date.getDay() - startOfWeek + 7) % 7;
    const next =
      event.key === 'ArrowLeft'
        ? addDays(date, -1)
        : event.key === 'ArrowRight'
          ? addDays(date, 1)
          : event.key === 'ArrowUp'
            ? addDays(date, -7)
            : event.key === 'ArrowDown'
              ? addDays(date, 7)
              : event.key === 'Home'
                ? addDays(date, -delta)
                : event.key === 'End'
                  ? addDays(date, 6 - delta)
                  : event.key === 'PageUp'
                    ? addMonths(date, event.shiftKey ? -12 : -1)
                    : event.key === 'PageDown'
                      ? addMonths(date, event.shiftKey ? 12 : 1)
                      : undefined;
    if (next) {
      event.preventDefault();
      if (disabled === true) return;
      navigate(next);
      return next;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(date);
    }
  }
  const start = addDays(month, -(month.getDay() - startOfWeek + 7) % 7);
  const count =
    Math.ceil(
      (((month.getDay() - startOfWeek + 7) % 7) +
        new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) /
        7,
    ) * 7;
  const dates = Array.from({ length: count }, (_, i) => addDays(start, i));
  return {
    value,
    reset: () => { reset(); setMonth(new Date(resetDate.current.getFullYear(), resetDate.current.getMonth(), 1)); setFocusedDate(resetDate.current); },
    month,
    setMonth,
    focusedDate,
    setFocusedDate,
    startOfWeek,
    dates,
    isDisabled,
    isSelected,
    isInRange,
    select,
    navigate,
    onKeyDown,
  };
}
export interface CalendarProps
  extends
    Omit<
      React.ComponentPropsWithoutRef<'div'>,
      'defaultValue' | 'onChange' | 'onKeyDown'
    >,
    UseCalendarOptions {
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement> | undefined;
  name?: string | undefined;
  form?: string | undefined;
}
export const Calendar = React.forwardRef<HTMLDivElement, CalendarProps>(
  (
    {
      mode = 'single',
      value,
      defaultValue,
      onValueChange,
      defaultMonth,
      min,
      max,
      locale = 'en-US',
      weekStartsOn,
      disabled,
      className,
      name,
      form,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const field = useFieldControl(props);
    disabled = disabled ?? field.disabled;
    const state = useCalendar({
      mode,
      value,
      defaultValue,
      onValueChange,
      defaultMonth,
      min,
      max,
      locale,
      weekStartsOn,
      disabled,
    });
    const resetElement = React.useRef<HTMLDivElement>(null);
    useFormReset(resetElement, state.reset, form);
    const resetRef = useComposedRefs(ref, resetElement);
    const grid = React.useRef<HTMLTableElement>(null);
    const titleId = React.useId();
    const focusAfterNavigation = React.useRef(false);
    React.useLayoutEffect(() => {
      if (focusAfterNavigation.current) {
        grid.current
          ?.querySelector<HTMLButtonElement>(
            `[data-date="${+day(state.focusedDate)}"]`,
          )
          ?.focus();
        focusAfterNavigation.current = false;
      }
    }, [state.focusedDate]);
    const monthLabel = new Intl.DateTimeFormat(locale, {
      month: 'long',
      calendar: 'gregory',
      year: 'numeric',
    }).format(state.month);
    const weekdayDates = Array.from(
      { length: 7 },
      (_, i) => new Date(2026, 5, 7 + state.startOfWeek + i),
    );
    const serialized =
      state.value instanceof Date ? state.value : state.value?.from;
    return (
      <div
        ref={resetRef}
        data-slot="calendar"
          data-invalid={(props['aria-invalid'] ?? field['aria-invalid']) && (props['aria-invalid'] ?? field['aria-invalid']) !== 'false' ? '' : undefined}
        data-mode={mode}
        data-disabled={disabled === true ? '' : undefined}
        className={cn(calendarVariants(), className)}
        {...props}
      >
        <div data-slot="calendar-header">
          <button
            type="button"
            data-slot="calendar-previous"
            aria-label="Previous month"
            disabled={
              disabled === true ||
              (!!min &&
                +new Date(
                  state.month.getFullYear(),
                  state.month.getMonth(),
                  0,
                ) < +day(min))
            }
            onClick={() => state.navigate(addMonths(state.month, -1))}
          >
            <Icon name="chevron-left" size="sm" />
          </button>
          <span id={titleId} data-slot="calendar-heading" aria-live="polite">
            {monthLabel}
          </span>
          <button
            type="button"
            data-slot="calendar-next"
            aria-label="Next month"
            disabled={
              disabled === true ||
              (!!max &&
                +new Date(
                  state.month.getFullYear(),
                  state.month.getMonth() + 1,
                  1,
                ) > +day(max))
            }
            onClick={() => state.navigate(addMonths(state.month, 1))}
          >
            <Icon name="chevron-right" size="sm" />
          </button>
        </div>
        <table
          ref={grid}
          role="grid"
          aria-labelledby={props['aria-labelledby'] ?? (props['aria-label'] ? undefined : field['aria-labelledby'] ?? titleId)}
          aria-label={props['aria-label']}
          aria-describedby={props['aria-describedby'] ?? field['aria-describedby']}
          aria-invalid={props['aria-invalid'] ?? field['aria-invalid']}
          aria-required={props['aria-required'] ?? field['aria-required']}
          aria-multiselectable={mode === 'range' || undefined}
          data-slot="calendar-grid"
        >
          <thead data-slot="calendar-head">
            <tr data-slot="calendar-weekdays">
              {weekdayDates.map((d) => (
                <th
                  key={d.getDay()}
                  data-slot="calendar-weekday"
                  abbr={new Intl.DateTimeFormat(locale, {
                    weekday: 'long',
                  }).format(d)}
                >
                  {new Intl.DateTimeFormat(locale, { weekday: 'short' })
                    .format(d)
                    .slice(0, 2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-slot="calendar-body">
            {Array.from({ length: state.dates.length / 7 }, (_, row) => (
              <tr key={row} data-slot="calendar-week">
                {state.dates.slice(row * 7, row * 7 + 7).map((date) => (
                  <td
                    role="gridcell"
                    key={+date}
                    data-slot="calendar-cell"
                    aria-selected={
                      state.isSelected(date) || state.isInRange(date)
                    }
                  >
                    <button
                      type="button"
                      data-slot="calendar-day"
                      data-date={+date}
                      aria-label={new Intl.DateTimeFormat(locale, {
                        dateStyle: 'full',
                        calendar: 'gregory',
                      }).format(date)}
                      aria-current={
                        equal(date, new Date()) ? 'date' : undefined
                      }
                      aria-disabled={state.isDisabled(date) || undefined}
                      data-disabled={state.isDisabled(date) ? '' : undefined}
                      data-state={
                        state.isSelected(date)
                          ? 'selected'
                          : state.isInRange(date)
                            ? 'in-range'
                            : 'unselected'
                      }
                      data-outside={
                        date.getMonth() !== state.month.getMonth()
                          ? ''
                          : undefined
                      }
                      tabIndex={equal(date, state.focusedDate) ? 0 : -1}
                      onFocus={() => state.setFocusedDate(date)}
                      onClick={() => {
                        state.setFocusedDate(date);
                        state.select(date);
                      }}
                      onKeyDown={(event) => {
                        onKeyDown?.(event);
                        if (event.defaultPrevented) return;
                        focusAfterNavigation.current = true;
                        if (!state.onKeyDown(event, date))
                          focusAfterNavigation.current = false;
                      }}
                    >
                      {date.getDate()}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {name && (
          <>
            <input
              data-slot="calendar-form-value"
              type="hidden"
              name={name}
              form={form}
              disabled={disabled === true}
              value={
                serialized
                  ? `${serialized.getFullYear()}-${String(serialized.getMonth() + 1).padStart(2, '0')}-${String(serialized.getDate()).padStart(2, '0')}`
                  : ''
              }
            />
            {mode === 'range' && (
              <input
                data-slot="calendar-form-end"
                disabled={disabled === true}
                type="hidden"
                name={`${name}.to`}
                form={form}
                value={
                  !(state.value instanceof Date) && state.value?.to
                    ? `${state.value.to.getFullYear()}-${String(state.value.to.getMonth() + 1).padStart(2, '0')}-${String(state.value.to.getDate()).padStart(2, '0')}`
                    : ''
                }
              />
            )}
          </>
        )}
      </div>
    );
  },
);
Calendar.displayName = 'Calendar';
