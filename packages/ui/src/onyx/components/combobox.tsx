/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { usePortalContainer } from "./popover";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { createPortal } from "react-dom";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useControllableState } from "../lib/use-controllable-state";
import { useComposedRefs } from "../lib/compose-refs";
import { useFloatingPosition } from "../lib/use-floating-position";
import { Icon } from "./icon";
import { Tag } from "./tag";
import { menuContentVariants, menuItemVariants } from "../lib/menu-styles";

export const comboboxVariants = cva("onyx-combobox");
export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
  description?: React.ReactNode;
}
export type ComboboxValue = string | string[];
export interface UseComboboxOptions {
  options: ComboboxOption[];
  value?: ComboboxValue;
  defaultValue?: ComboboxValue;
  onValueChange?: (value: ComboboxValue) => void;
  multiple?: boolean;
  inputValue?: string;
  defaultInputValue?: string;
  onInputValueChange?: (query: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** false for server/consumer filtering; otherwise defaults to label substring. */
  filter?: false | ((option: ComboboxOption, query: string) => boolean);
  onCreate?: (query: string) => void;
  disabled?: boolean;
  activeIndex?: number;
  defaultActiveIndex?: number;
  onActiveIndexChange?: (index: number) => void;
}
export function useCombobox({
  options,
  value: controlledValue,
  defaultValue,
  onValueChange,
  multiple = false,
  inputValue,
  defaultInputValue,
  onInputValueChange,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  filter,
  onCreate,
  disabled,
  activeIndex: controlledActiveIndex,
  defaultActiveIndex = -1,
  onActiveIndexChange,
}: UseComboboxOptions) {
  const initial = controlledValue ?? defaultValue ?? (multiple ? [] : "");
  const [value, setValue] = useControllableState<ComboboxValue>({
    value: controlledValue,
    defaultValue: initial,
    onChange: onValueChange,
  });
  const [query, setQuery] = useControllableState({
    value: inputValue,
    defaultValue:
      defaultInputValue ??
      (typeof initial === "string"
        ? (options.find((o) => o.value === initial)?.label ?? "")
        : ""),
    onChange: onInputValueChange,
  });
  const [openState, setOpenState] = useControllableState({
    value: controlledOpen,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const open = openState && !disabled;
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const editing = React.useRef(defaultInputValue !== undefined);
  const selectedLabel = typeof value === "string"
    ? options.find((o) => o.value === value)?.label ?? ""
    : "";
  const previousValue = React.useRef(value);
  React.useEffect(() => {
    if (previousValue.current !== value) editing.current = false;
    previousValue.current = value;
    if (inputValue === undefined && !editing.current && !multiple) setQuery(selectedLabel);
  }, [value, selectedLabel, inputValue, multiple, setQuery]);
  const reconcile = () => {
    editing.current = false;
    if (inputValue === undefined) setQuery(multiple ? "" : selectedLabel);
  };
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listboxId = React.useId();
  const filteredOptions =
    filter === false
      ? options
      : options.filter((option) =>
          (
            filter ??
            ((o, q) =>
              o.label.toLocaleLowerCase().includes(q.toLocaleLowerCase()))
          )(option, query),
        );
  const canCreate =
    !!onCreate &&
    !!query.trim() &&
    !options.some(
      (o) => o.label.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
    );
  const count = filteredOptions.length + (canCreate ? 1 : 0);
  const enabledIndices = Array.from({ length: count }, (_, i) => i).filter(
    (i) => !filteredOptions[i]?.disabled,
  );
  const keys = filteredOptions.map((option) => `value:${option.value}`);
  if (canCreate) keys.push(`create:${query.trim()}`);
  const initialActive = React.useRef(true);
  React.useEffect(() => {
    if (initialActive.current) {
      initialActive.current = false;
      setActiveKey(keys[defaultActiveIndex] ?? null);
    }
  }, []);
  const resolvedIndex = controlledActiveIndex ?? (activeKey === null && initialActive.current ? defaultActiveIndex : keys.indexOf(activeKey ?? ""));
  const active = enabledIndices.includes(resolvedIndex) ? resolvedIndex : -1;
  const setActiveIndex = (index: number) => {
    initialActive.current = false;
    setActiveKey(keys[index] ?? null);
    onActiveIndexChange?.(index);
  };
  React.useEffect(() => {
    if (activeKey !== null && (!keys.includes(activeKey) || active < 0)) setActiveKey(null);
  }, [activeKey, keys.join("\0"), active]);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const setOpen = (next: boolean) => {
    if (!disabled) setOpenState(next);
  };
  const previousQuery = React.useRef(query);
  React.useEffect(() => {
    if (previousQuery.current !== query) {
      setActiveIndex(-1);
      previousQuery.current = query;
    }
  }, [query]);
  React.useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${listboxId}-${active}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, listboxId]);
  const select = (index: number) => {
    if (disabled) return;
    if (index === filteredOptions.length && canCreate) {
      onCreate?.(query.trim());
      setQuery("");
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    const option = filteredOptions[index];
    editing.current = false;
    if (!option || option.disabled) return;
    if (multiple) {
      setValue(
        selected.includes(option.value)
          ? selected.filter((v) => v !== option.value)
          : [...selected, option.value],
      );
      setQuery("");
    } else {
      setValue(option.value);
      setQuery(controlledValue === undefined ? option.label : selectedLabel);
      setOpen(false);
    }
    setActiveIndex(-1);
  };
  const remove = (item: string) => {
    if (!disabled) setValue(multiple ? selected.filter((v) => v !== item) : "");
  };
  const inputProps: React.InputHTMLAttributes<HTMLInputElement> = {
    role: "combobox",
    "aria-autocomplete": filter === false ? "none" : "list",
    "aria-haspopup": "listbox",
    "aria-expanded": open,
    "aria-controls": open ? listboxId : undefined,
    "aria-activedescendant":
      open && active >= 0 ? `${listboxId}-${active}` : undefined,
    disabled,
    value: query,
    onChange: (event) => {
      editing.current = true;
      setQuery(event.target.value);
      setActiveIndex(-1);
      setOpen(true);
    },
    onFocus: () => setOpen(true),
    onBlur: () => {
      editing.current = false;
      if (inputValue === undefined && !multiple) setQuery(selectedLabel);
      setOpen(false);
      setActiveIndex(-1);
    },
    onKeyDown: (event) => {
      if (event.nativeEvent.isComposing || disabled) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
        const position = open ? enabledIndices.indexOf(active) : -1;
        const next =
          event.key === "ArrowDown"
            ? Math.min(position + 1, enabledIndices.length - 1)
            : position < 0
              ? enabledIndices.length - 1
              : Math.max(0, position - 1);
        setActiveIndex(enabledIndices[next] ?? -1);
      } else if (event.key === "Enter" && open && active >= 0) {
        event.preventDefault();
        select(active);
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
      } else if (event.key === "Tab") {
        setOpen(false);
        setActiveIndex(-1);
      }
    },
  };
  const listboxProps: React.HTMLAttributes<HTMLDivElement> = {
    id: listboxId,
    role: "listbox",
    "aria-multiselectable": multiple || undefined,
  };
  function getOptionProps(index: number): React.HTMLAttributes<HTMLDivElement> {
    const option = filteredOptions[index];
    return {
      id: `${listboxId}-${index}`,
      role: "option",
      "aria-selected": option ? selected.includes(option.value) : false,
      "aria-disabled": option?.disabled || undefined,
      onPointerMove: () => {
        if (!option?.disabled) setActiveIndex(index);
      },
      onMouseDown: (event) => event.preventDefault(),
      onClick: () => select(index),
    };
  }
  return {
    value,
    selected,
    query,
    setQuery,
    reconcile,
    open,
    setOpen,
    activeIndex: active,
    setActiveIndex,
    filteredOptions,
    canCreate,
    inputRef,
    inputProps,
    listboxProps,
    getOptionProps,
    select,
    remove,
  };
}
export const ComboboxHighlight = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & {
    text: string;
    query: string;
    asChild?: boolean | undefined;
  }
>(({ text, query, className, asChild, children, ...props }, ref) => {
  const index = query
    ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    : -1;
  const content =
    index < 0 ? (
      text
    ) : (
      <>
        {text.slice(0, index)}
        <mark data-slot="combobox-match" className="onyx-combobox-match">
          {text.slice(index, index + query.length)}
        </mark>
        {text.slice(index + query.length)}
      </>
    );
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      ref={ref}
      data-slot="combobox-option-label"
      className={cn(className)}
      {...props}
    >
      {asChild && React.isValidElement(children)
        ? React.cloneElement(
            children as React.ReactElement<{ children?: React.ReactNode | undefined }>,
            {},
            content,
          )
        : content}
    </Comp>
  );
});
ComboboxHighlight.displayName = "ComboboxHighlight";
export interface ComboboxProps extends UseComboboxOptions {
  className?: string;
  style?: React.CSSProperties;
  rootProps?: React.HTMLAttributes<HTMLDivElement>;
  rootRef?: React.Ref<HTMLDivElement>;
  container?: HTMLElement | null;
  inputProps?: Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "disabled"
  >;
  placeholder?: string;
  label?: string;
  emptyState?: React.ReactNode;
  createOption?: React.ReactNode | ((query: string) => React.ReactNode);
  renderOption?: (option: ComboboxOption, query: string) => React.ReactNode;
  renderSelected?: (
    option: ComboboxOption,
    remove: () => void,
  ) => React.ReactNode;
  showTags?: boolean;
  contentClassName?: string;
}
export const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(
  (
    componentProps,
    ref,
  ) => {
    const {
      className,
      style,
      rootProps,
      rootRef: forwardedRootRef,
      container,
      inputProps,
      placeholder,
      label,
      emptyState = "No results.",
      createOption,
      renderOption,
      renderSelected,
      showTags = true,
      contentClassName,
      ...options
    } = componentProps;
    const portalContainer = usePortalContainer(container);
    const state = useCombobox(options);
    // Local typing reuses props; a parent render reasserts its controlled value.
    React.useLayoutEffect(() => {
      if (options.value !== undefined) state.reconcile();
    }, [componentProps]);
    const floating = useFloatingPosition({
      open: state.open,
      matchWidth: true,
      offset: 4,
    });
    const composedRef = useComposedRefs(ref, state.inputRef);
    const inputId = React.useId();
    const rootRef = React.useRef<HTMLDivElement>(null);
    const composedRootRef = useComposedRefs(rootRef, forwardedRootRef);
    return (
      <div
        {...rootProps}
        ref={composedRootRef}
        style={{ ...rootProps?.style, ...style }}
        data-slot="combobox"
        data-state={state.open ? "open" : "closed"}
        data-disabled={options.disabled ? "" : undefined}
        className={cn(comboboxVariants(), rootProps?.className, className)}
      >
        {label && (
          <label data-slot="combobox-label" htmlFor={inputProps?.id ?? inputId}>
            {label}
          </label>
        )}
        <div
          ref={floating.refs.setReference}
          data-slot="combobox-control"
          className="onyx-combobox-control"
        >
          {options.multiple &&
            showTags &&
            state.selected.map((value) => {
              const option = options.options.find((o) => o.value === value) ?? {
                value,
                label: value,
              };
              return (
                <React.Fragment key={value}>
                  {renderSelected ? (
                    renderSelected(option, () => state.remove(value))
                  ) : (
                    <Tag
                      data-slot="combobox-chip"
                      disabled={options.disabled}
                      onRemove={() => state.remove(value)}
                    >
                      {option.label}
                    </Tag>
                  )}
                </React.Fragment>
              );
            })}
          <input
            {...inputProps}
            {...state.inputProps}
            id={inputProps?.id ?? inputId}
            ref={composedRef}
            data-slot="combobox-input"
            className={cn("onyx-combobox-input", inputProps?.className)}
            placeholder={placeholder}
            onChange={(event) => {
              inputProps?.onChange?.(event);
              if (!event.defaultPrevented) state.inputProps.onChange?.(event);
            }}
            onFocus={(event) => {
              inputProps?.onFocus?.(event);
              if (!event.defaultPrevented) state.inputProps.onFocus?.(event);
            }}
            onBlur={(event) => {
              inputProps?.onBlur?.(event);
              if (!event.defaultPrevented) state.inputProps.onBlur?.(event);
            }}
            onKeyDown={(event) => {
              inputProps?.onKeyDown?.(event);
              if (!event.defaultPrevented) state.inputProps.onKeyDown?.(event);
            }}
          />
          <button
            type="button"
            data-slot="combobox-trigger"
            className="onyx-combobox-trigger"
            tabIndex={-1}
            disabled={options.disabled}
            aria-label="Toggle suggestions"
            aria-controls={state.listboxProps.id}
            aria-expanded={state.open}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              state.inputRef.current?.focus();
              state.setOpen(!state.open);
            }}
          >
            <Icon name="chevron-down" />
          </button>
        </div>
        {state.open &&
          typeof document !== "undefined" &&
          createPortal(
            <DismissableLayer asChild onDismiss={() => state.setOpen(false)}
              onInteractOutside={(event) => {
                if (rootRef.current?.contains(event.target as Node)) event.preventDefault();
              }}>
            <div
              {...state.listboxProps}
              ref={floating.refs.setFloating}
              style={{ ...floating.floatingStyles, pointerEvents: "auto" }}
              aria-label={label ?? inputProps?.["aria-label"] ?? "Suggestions"}
              data-slot="combobox-listbox"
              data-state="open"
              data-side={floating.placement.split("-")[0]}
              className={cn(menuContentVariants(), contentClassName)}
            >
              {state.filteredOptions.map((option, index) => (
                <div
                  key={option.value}
                  {...state.getOptionProps(index)}
                  data-slot="combobox-option"
                  data-highlighted={
                    state.activeIndex === index ? "" : undefined
                  }
                  data-disabled={option.disabled ? "" : undefined}
                  className={cn(menuItemVariants({ inset: true }))}
                >
                  <span
                    data-slot="combobox-indicator"
                    className="onyx-menu-indicator"
                  >
                    {state.selected.includes(option.value) && (
                      <Icon name="check" size="sm" />
                    )}
                  </span>
                  {renderOption ? (
                    renderOption(option, state.query)
                  ) : (
                    <ComboboxHighlight
                      text={option.label}
                      query={state.query}
                    />
                  )}
                  {option.description && (
                    <span
                      data-slot="combobox-option-description"
                      className="onyx-menu-shortcut"
                    >
                      {option.description}
                    </span>
                  )}
                </div>
              ))}
              {!state.filteredOptions.length && !state.canCreate && (
                <div
                  data-slot="combobox-empty"
                  className="onyx-combobox-empty"
                  role="status"
                >
                  {emptyState}
                </div>
              )}
              {state.canCreate && (
                <>
                  <div
                    data-slot="combobox-separator"
                    className="onyx-menu-separator"
                  />
                  <div
                    {...state.getOptionProps(state.filteredOptions.length)}
                    data-slot="combobox-create-option"
                    data-highlighted={
                      state.activeIndex === state.filteredOptions.length
                        ? ""
                        : undefined
                    }
                    className={menuItemVariants()}
                  >
                    {typeof createOption === "function"
                      ? createOption(state.query)
                      : (createOption ?? (
                          <>
                            <Icon name="add" />
                            Add “{state.query}”
                          </>
                        ))}
                  </div>
                </>
              )}
            </div>
            </DismissableLayer>,
            portalContainer ?? state.inputRef.current?.ownerDocument.body ?? document.body,
          )}
      </div>
    );
  },
);
Combobox.displayName = "Combobox";
