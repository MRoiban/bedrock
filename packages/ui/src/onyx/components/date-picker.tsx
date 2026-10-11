/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useComposedRefs } from "../lib/compose-refs";
import { useControllableState } from "../lib/use-controllable-state";
import {
  Calendar,
  type CalendarProps,
  type CalendarValue,
  type UseCalendarOptions,
} from "./calendar";
import {
  Popover,
  PopoverAnchor,
  PopoverTrigger,
  PopoverContent,
} from "./popover";
import { Input } from "./input";
import { Button } from "./button";
import { Icon } from "./icon";

export const datePickerVariants = cva("onyx-date-picker");
const iso = (date?: Date) =>
  date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : "";
const serialize = (value: CalendarValue) =>
  value instanceof Date
    ? iso(value)
    : value?.from
      ? `${iso(value.from)} – ${iso(value.to)}`
      : "";
/** Human-readable range for the read-only range input, e.g. "6–10 Oct 2026". */
export function formatRange(value: CalendarValue, locale?: string): string {
  if (!value || value instanceof Date || !value.from) return "";
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return value.to ? format.formatRange(value.from, value.to) : format.format(value.from);
}
export interface UseDatePickerOptions extends UseCalendarOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}
/** ISO single-date editing; range selection delegates to Calendar. */
export function useDatePicker({
  value: controlled,
  defaultValue,
  onValueChange,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  mode = "single",
  min,
  max,
  disabled,
}: UseDatePickerOptions = {}) {
  const [value, setValue] = useControllableState<CalendarValue>({
    value: controlled,
    defaultValue,
    onChange: onValueChange,
  });
  const [open, setOpen] = useControllableState({
    value: controlledOpen,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const [draft, setDraft] = React.useState(serialize(value));
  const [invalid, setInvalid] = React.useState(false);
  const serialized = serialize(value);
  React.useEffect(() => {
    setDraft(serialized);
    setInvalid(false);
  }, [serialized, controlled]);
  const select = (next: CalendarValue) => {
    setValue(next);
    setDraft(serialize(controlled === undefined ? next : controlled));
    setInvalid(false);
    if (mode === "single" || (next && !(next instanceof Date) && next.to))
      setOpen(false);
  };
  const commit = () => {
    if (mode === "range" || disabled === true) return;
    if (!draft.trim()) {
      select(undefined);
      return;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft);
    if (!match) {
      setInvalid(true);
      return;
    }
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(+match[1]!, +match[2]! - 1, +match[3]!);
    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (
      iso(date) !== draft ||
      (min && date < startOfDay(min)) ||
      (max && date > startOfDay(max)) ||
      (typeof disabled === "function" && disabled(date))
    ) {
      setInvalid(true);
      return;
    }
    select(date);
  };
  return {
    value,
    open: open && disabled !== true,
    setOpen,
    draft,
    setDraft,
    invalid,
    select,
    commit,
    mode,
    reconcile: () => { setDraft(serialized); setInvalid(false); },
  };
}
export interface DatePickerProps extends UseDatePickerOptions {
  className?: string;
  style?: React.CSSProperties;
  rootProps?: React.HTMLAttributes<HTMLDivElement>;
  rootRef?: React.Ref<HTMLDivElement>;
  form?: string;
  label?: string;
  name?: string;
  inputProps?: Omit<
    React.ComponentPropsWithoutRef<typeof Input>,
    "value" | "defaultValue" | "disabled"
  >;
  calendarProps?: Omit<CalendarProps, keyof UseCalendarOptions>;
  contentProps?: React.ComponentPropsWithoutRef<typeof PopoverContent>;
}
export const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(
  (
    componentProps,
    ref,
  ) => {
    const {
      className,
      style,
      rootProps,
      rootRef,
      form,
      label = "Choose date",
      name,
      inputProps,
      calendarProps,
      contentProps,
      ...options
    } = componentProps;
    const state = useDatePicker(options);
    // Local draft updates reuse props; a parent render reasserts its controlled value.
    React.useLayoutEffect(() => {
      if (options.value !== undefined) state.reconcile();
    }, [componentProps]);
    const id = React.useId();
    // A plain callback keeps the ref valid when the host app resolves a second copy of React's types.
    const composedRootRef = useComposedRefs(rootRef);
    return (
      <div
        {...rootProps}
        ref={composedRootRef}
        style={{ ...rootProps?.style, ...style }}
        data-slot="date-picker"
        data-state={state.open ? "open" : "closed"}
        data-invalid={state.invalid ? "" : undefined}
        className={cn(datePickerVariants(), rootProps?.className, className)}
      >
        <label htmlFor={inputProps?.id ?? id} data-slot="date-picker-label">
          {label}
        </label>
        <Popover open={state.open} onOpenChange={state.setOpen}>
          <PopoverAnchor asChild>
            <div
              data-slot="date-picker-control"
              className="onyx-date-picker-control"
            >
              <Input
                {...inputProps}
                ref={ref}
                id={inputProps?.id ?? id}
                data-slot="date-picker-input"
                name={undefined}
                value={
                  state.mode === "range"
                    ? formatRange(state.value, options.locale)
                    : state.draft
                }
                readOnly={state.mode === "range" || inputProps?.readOnly}
                disabled={options.disabled === true}
                aria-invalid={state.invalid || inputProps?.["aria-invalid"]}
                placeholder={
                  inputProps?.placeholder ??
                  (state.mode === "range"
                    ? "Select a date range"
                    : "YYYY-MM-DD")
                }
                onChange={(event) => {
                  inputProps?.onChange?.(event);
                  if (!event.defaultPrevented)
                    state.setDraft(event.target.value);
                }}
                onBlur={(event) => {
                  inputProps?.onBlur?.(event);
                  if (!event.defaultPrevented) state.commit();
                }}
                onKeyDown={(event) => {
                  inputProps?.onKeyDown?.(event);
                  if (event.defaultPrevented) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    state.commit();
                  }
                  if (event.key === "ArrowDown" && event.altKey) {
                    event.preventDefault();
                    state.setOpen(true);
                  }
                }}
              />
              <PopoverTrigger asChild>
                <Button
                  data-slot="date-picker-trigger"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Open calendar: ${label}`}
                  disabled={options.disabled === true}
                >
                  <Icon name="calendar" />
                </Button>
              </PopoverTrigger>
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            {...contentProps}
            data-slot="date-picker-content"
            className={cn("onyx-date-picker-content", contentProps?.className)}
            onOpenAutoFocus={(event) => {
              contentProps?.onOpenAutoFocus?.(event);
              if (!event.defaultPrevented) {
                event.preventDefault();
                (event.currentTarget as HTMLElement)
                  .querySelector<HTMLElement>(
                    '[data-slot="calendar-day"][tabindex="0"]',
                  )
                  ?.focus();
              }
            }}
          >
            <Calendar
              {...calendarProps}
              mode={options.mode}
              value={state.value}
              onValueChange={state.select}
              defaultMonth={options.defaultMonth}
              min={options.min}
              max={options.max}
              locale={options.locale}
              weekStartsOn={options.weekStartsOn}
              disabled={options.disabled}
            />
          </PopoverContent>
        </Popover>
        {(name ?? inputProps?.name) && (
          <>
            <input
              data-slot="date-picker-form-start"
              type="hidden"
              name={name ?? inputProps?.name}
              form={form ?? inputProps?.form}
              disabled={options.disabled === true}
              value={
                state.value instanceof Date
                  ? iso(state.value)
                  : iso(state.value?.from)
              }
            />
            {state.mode === "range" && <input
              data-slot="date-picker-form-end"
              type="hidden"
              name={`${name ?? inputProps?.name}.to`}
              form={form ?? inputProps?.form}
              disabled={options.disabled === true}
              value={state.value instanceof Date ? "" : iso(state.value?.to)}
            />}
          </>
        )}
      </div>
    );
  },
);
DatePicker.displayName = "DatePicker";
