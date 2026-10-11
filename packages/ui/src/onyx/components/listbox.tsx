/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useControllableState } from "../lib/use-controllable-state";
import { useComposedRefs } from "../lib/compose-refs";
import { ListRow } from "./panel";
import { useVirtualList } from "./virtual-list";

export type CollectionKey = string | number;
export interface UseListboxOptions<T> {
  items: readonly T[];
  getKey: (item: T) => CollectionKey;
  getText?: ((item: T) => string) | undefined;
  isDisabled?: ((item: T) => boolean) | undefined;
  selectionMode?: "single" | "multiple" | "none" | undefined;
  selectedKeys?: readonly CollectionKey[] | undefined;
  defaultSelectedKeys?: readonly CollectionKey[] | undefined;
  onSelectionChange?: ((keys: CollectionKey[]) => void) | undefined;
  focusedKey?: CollectionKey | null | undefined;
  defaultFocusedKey?: CollectionKey | null | undefined;
  onFocusChange?: ((key: CollectionKey | null) => void) | undefined;
}
export function useListbox<T>({
  items,
  getKey,
  getText = (item) => String(getKey(item)),
  isDisabled = () => false,
  selectionMode = "single",
  selectedKeys: controlled,
  defaultSelectedKeys = [],
  onSelectionChange,
  focusedKey: controlledFocus,
  defaultFocusedKey,
  onFocusChange,
}: UseListboxOptions<T>) {
  const id = React.useId();
  const [selectedKeys, setSelectedKeys] = useControllableState<
    readonly CollectionKey[]
  >({
    value: controlled,
    defaultValue:
      selectionMode === "single"
        ? defaultSelectedKeys.slice(0, 1)
        : defaultSelectedKeys,
    onChange: (keys) => onSelectionChange?.([...keys]),
  });
  const [focus, setFocusedKey] = useControllableState<CollectionKey | null>({
    value: controlledFocus,
    defaultValue:
      defaultFocusedKey ??
      selectedKeys[0] ??
      (items.find((item) => !isDisabled(item)) !== undefined
        ? getKey(items.find((item) => !isDisabled(item))!)
        : null),
    onChange: onFocusChange,
  });
  const keyIndices = React.useMemo(
    () => new Map(items.map((item, index) => [getKey(item), index])),
    [items, getKey],
  );
  const selectedSet = React.useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const enabled = items.filter((item) => !isDisabled(item));
  const focusedKey = enabled.some((item) => getKey(item) === focus)
    ? focus
    : enabled.find((item) => selectedKeys.includes(getKey(item)))
      ? getKey(enabled.find((item) => selectedKeys.includes(getKey(item)))!)
      : enabled[0] !== undefined
        ? getKey(enabled[0])
        : null;
  const anchor = React.useRef<CollectionKey | null>(focusedKey);
  const search = React.useRef({ text: "", time: 0 });
  const itemId = (key: CollectionKey) =>
    `${id}-item-${typeof key}-${encodeURIComponent(String(key))}`;
  const select = (
    key: CollectionKey,
    modifiers: {
      shiftKey?: boolean | undefined;
      ctrlKey?: boolean | undefined;
      metaKey?: boolean | undefined;
      toggle?: boolean | undefined;
    } = {},
  ) => {
    if (!enabled.some((item) => getKey(item) === key)) return;
    setFocusedKey(key);
    if (selectionMode === "none") return;
    if (selectionMode === "single") {
      setSelectedKeys([key]);
      anchor.current = key;
      return;
    }
    if (modifiers.shiftKey && anchor.current !== null) {
      const from = enabled.findIndex((item) => getKey(item) === anchor.current);
      const to = enabled.findIndex((item) => getKey(item) === key);
      const range = enabled
        .slice(
          Math.min(from < 0 ? to : from, to),
          Math.max(from < 0 ? to : from, to) + 1,
        )
        .map(getKey);
      setSelectedKeys((current) =>
        modifiers.ctrlKey || modifiers.metaKey
          ? [...new Set([...current, ...range])]
          : range,
      );
    } else {
      setSelectedKeys((current) =>
        modifiers.ctrlKey || modifiers.metaKey || modifiers.toggle
          ? current.includes(key)
            ? current.filter((value) => value !== key)
            : [...current, key]
          : [key],
      );
      anchor.current = key;
    }
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.target !== event.currentTarget ||
      event.altKey
    )
      return;
    const index = enabled.findIndex((item) => getKey(item) === focusedKey);
    let next: T | undefined;
    if (event.key === "ArrowDown")
      next = enabled[Math.min(enabled.length - 1, index + 1)];
    else if (event.key === "ArrowUp") next = enabled[Math.max(0, index - 1)];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "a" &&
      selectionMode === "multiple"
    ) {
      event.preventDefault();
      setSelectedKeys(enabled.map(getKey));
      return;
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (focusedKey !== null)
        select(focusedKey, { ...event, toggle: event.key === " " });
      return;
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const now = Date.now();
      const continuing = now - search.current.time <= 700;
      const text =
        !continuing
          ? event.key
          : search.current.text + event.key;
      search.current = { text: text.toLocaleLowerCase(), time: now };
      const cycling = [...text].every((char) => char === text[0]);
      const refining = continuing && text.length > 1 && !cycling;
      const prefix = cycling
        ? text[0]!
        : text;
      next = [
        ...(refining && index >= 0 ? [enabled[index]!] : []),
        ...enabled.slice(index + 1), ...enabled.slice(0, index + 1),
      ].find(
        (item) =>
          getText(item)
            .toLocaleLowerCase()
            .startsWith(prefix.toLocaleLowerCase()),
      );
    } else return;
    event.preventDefault();
    if (next !== undefined) {
      const key = getKey(next);
      if (event.shiftKey) select(key, event);
      else {
        anchor.current = key;
        setFocusedKey(key);
      }
    }
  };
  return {
    items,
    selectedKeys,
    focusedKey,
    setSelectedKeys,
    setFocusedKey: (key: CollectionKey | null) => { anchor.current = key; setFocusedKey(key); },
    select,
    itemId,
    onKeyDown,
    getRootProps: () => ({
      role: "listbox",
      tabIndex: 0,
      "aria-multiselectable": selectionMode === "multiple" || undefined,
      "aria-activedescendant":
        focusedKey === null ? undefined : itemId(focusedKey),
      onKeyDown,
    }),
    getItemProps: (item: T, includePosition = true) => {
      const key = getKey(item);
      return {
        id: itemId(key),
        role: "option",
        "aria-posinset": includePosition ? (keyIndices.get(key) ?? -1) + 1 : undefined,
        "aria-setsize": includePosition ? items.length : undefined,
        "aria-selected":
          selectionMode === "none" ? undefined : selectedSet.has(key),
        "aria-disabled": isDisabled(item) || undefined,
        "data-selected": selectedSet.has(key) ? "true" : "false",
        "data-focused": focusedKey === key ? "true" : "false",
        "data-disabled": isDisabled(item) ? "" : undefined,
        "data-state": selectedSet.has(key) ? "selected" : "idle",
        onClick: (event: React.MouseEvent<HTMLElement>) => {
          if (event.defaultPrevented) return;
          select(key, event);
          event.currentTarget
            .closest<HTMLElement>("[role=listbox], [role=tree]")
            ?.focus();
        },
      };
    },
  };
}
export const listboxVariants = cva("onyx-listbox");
export interface ListboxProps<T>
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "onChange">,
    UseListboxOptions<T> {
  children?: React.ReactElement;
  renderItem?: (
    item: T,
    state: { selected: boolean; focused: boolean },
  ) => React.ReactNode;
  getGroup?: (item: T) => string;
  virtualized?: boolean;
  rowHeight?: number;
  asChild?: boolean;
}
function ListboxImpl<T>(
  {
    items,
    getKey,
    getText,
    isDisabled,
    selectionMode,
    selectedKeys,
    defaultSelectedKeys,
    onSelectionChange,
    focusedKey,
    defaultFocusedKey,
    onFocusChange,
    renderItem,
    children,
    getGroup,
    virtualized = false,
    rowHeight,
    className,
    asChild,
    onKeyDown,
    style,
    ...props
  }: ListboxProps<T>,
  forwardedRef: React.ForwardedRef<HTMLDivElement>,
) {
  const grouped = new Map<string, T[]>();
  if (getGroup)
    items.forEach((item) => {
      const group = getGroup(item);
      const bucket = grouped.get(group);
      if (bucket) bucket.push(item);
      else grouped.set(group, [item]);
    });
  const groups = [...grouped.keys()];
  const orderedItems = getGroup ? [...grouped.values()].flat() : items;
  const model = useListbox({
    items: orderedItems,
    getKey,
    getText,
    isDisabled,
    selectionMode,
    selectedKeys,
    defaultSelectedKeys,
    onSelectionChange,
    focusedKey,
    defaultFocusedKey,
    onFocusChange,
  });
  type VirtualRow =
    | { kind: "label"; group: string }
    | { kind: "option"; item: T; group?: string };
  const virtualRows: VirtualRow[] = getGroup
    ? groups.flatMap((group) => [
        { kind: "label" as const, group },
        ...grouped
          .get(group)!
          .map((item) => ({ kind: "option" as const, item, group })),
      ])
    : items.map((item) => ({ kind: "option", item }));
  const list = useVirtualList({
    count: virtualRows.length,
    getKey: (index) => {
      const entry = virtualRows[index]!;
      return entry.kind === "label"
        ? `group:${entry.group}`
        : `option:${typeof getKey(entry.item)}:${getKey(entry.item)}`;
    },
    enabled: virtualized,
    rowHeight,
    activeIndex: virtualRows.findIndex(
      (entry) =>
        entry.kind === "option" && getKey(entry.item) === model.focusedKey,
    ),
  });
  const ref = useComposedRefs(forwardedRef, list.ref);
  React.useLayoutEffect(() => {
    if (
      !virtualized &&
      document.activeElement === list.ref.current &&
      model.focusedKey !== null
    )
      document
        .getElementById(model.itemId(model.focusedKey))
        ?.scrollIntoView?.({ block: "nearest" });
  }, [model.focusedKey, virtualized]);
  const row = (item: T) => (
    <ListRow
      key={`${typeof getKey(item)}:${getKey(item)}`}
      data-slot="listbox-option"
      {...model.getItemProps(item)}
    >
      {renderItem
        ? renderItem(item, {
            selected: model.selectedKeys.includes(getKey(item)),
            focused: model.focusedKey === getKey(item),
          })
        : (getText?.(item) ?? String(getKey(item)))}
    </ListRow>
  );
  const Component = asChild ? Slot : "div";
  const virtualRow = (v: (typeof list.virtualItems)[number]) => {
    const entry = virtualRows[v.index]!;
    return (
      <div
        key={v.key}
        data-slot="listbox-virtual-row"
        style={{ position: "absolute", top: v.start, width: "100%" }}
      >
        {entry.kind === "label" ? (
          <div
            data-slot="listbox-group-label"
            style={{
              height: v.size,
              paddingBlock: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            {entry.group}
          </div>
        ) : (
          row(entry.item)
        )}
      </div>
    );
  };
  const content = virtualized ? (
    <div
      data-slot="listbox-content"
      style={{ height: list.totalSize, position: "relative" }}
    >
      {getGroup
        ? groups.map((group) => {
            const visible = list.virtualItems.filter(
              (v) => virtualRows[v.index]!.group === group,
            );
            if (!visible.length) return null;
            return (
              <div
                key={group}
                data-slot="listbox-group"
                role={
                  visible.some((v) => virtualRows[v.index]!.kind === "option")
                    ? "group"
                    : "presentation"
                }
                aria-label={group}
              >
                {visible.map(virtualRow)}
              </div>
            );
          })
        : list.virtualItems.map(virtualRow)}
    </div>
  ) : getGroup ? (
    groups.map((group) => (
      <ListboxGroup key={group} label={group}>
        {grouped.get(group)!.map(row)}
      </ListboxGroup>
    ))
  ) : (
    items.map(row)
  );
  return (
    <Component
      ref={ref}
      data-slot="listbox"
      data-orientation="vertical"
      className={cn(listboxVariants(), className)}
      {...props}
      style={{ ...style, ...(rowHeight === undefined ? {} : { "--onyx-row-height": `${rowHeight}px` }) } as React.CSSProperties}
      {...model.getRootProps()}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        model.onKeyDown(event);
      }}
    >
      {asChild && children
        ? React.cloneElement(children, {}, content)
        : content}
    </Component>
  );
}
export const Listbox = React.forwardRef(ListboxImpl) as <T>(
  props: ListboxProps<T> & React.RefAttributes<HTMLDivElement>,
) => React.ReactElement;
export const ListboxGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { label: string; asChild?: boolean | undefined }
>(({ label, children, asChild, className, ...props }, ref) => {
  const id = React.useId();
  const child =
    asChild && React.isValidElement<{ children?: React.ReactNode | undefined }>(children)
      ? children
      : null;
  const content = (
    <>
      <div id={id} data-slot="listbox-group-label">
        {label}
      </div>
      {child ? child.props.children : children}
    </>
  );
  const Component = asChild ? Slot : "div";
  return (
    <Component
      ref={ref}
      data-slot="listbox-group"
      role="group"
      aria-labelledby={id}
      className={cn("onyx-listbox-group", className)}
      {...props}
    >
      {child ? React.cloneElement(child, {}, content) : content}
    </Component>
  );
});
ListboxGroup.displayName = "ListboxGroup";
