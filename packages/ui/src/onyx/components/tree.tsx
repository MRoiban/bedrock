/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useControllableState } from "../lib/use-controllable-state";
import { useComposedRefs } from "../lib/compose-refs";
import {
  useListbox,
  type CollectionKey,
  type UseListboxOptions,
} from "./listbox";
import { useVirtualList } from "./virtual-list";
import { TreeRow } from "./panel";
import { Icon } from "./icon";
import { Button } from "./button";
import { resolveTreeNavigationAction } from "../lib/tree-navigation";
export {
  resolveTreeNavigationAction,
  findTreeTypeAheadMatch,
  type TreeNavigationItem,
  type TreeNavigationAction,
  type TreeNavigationOptions,
} from "../lib/tree-navigation";

export interface TreeNode<T> {
  item: T;
  key: CollectionKey;
  parentKey: CollectionKey | null;
  depth: number;
  posInSet: number;
  setSize: number;
  expandable: boolean;
}
export interface TreeCollectionOptions<T> {
  items: readonly T[];
  getKey: (item: T) => CollectionKey;
  getChildren: (item: T) => readonly T[] | undefined;
  isExpandable?: ((item: T) => boolean) | undefined;
}
export function flattenTree<T>(
  { items, getKey, getChildren, isExpandable }: TreeCollectionOptions<T>,
  expandedKeys: readonly CollectionKey[],
): TreeNode<T>[] {
  const expanded = new Set(expandedKeys);
  const rows: TreeNode<T>[] = [];
  const visit = (
    siblings: readonly T[],
    parentKey: CollectionKey | null,
    depth: number,
    ancestors: Set<CollectionKey>,
  ) => {
    siblings.forEach((item, index) => {
      const key = getKey(item);
      if (ancestors.has(key)) return;
      const children = getChildren(item);
      rows.push({
        item,
        key,
        parentKey,
        depth,
        posInSet: index + 1,
        setSize: siblings.length,
        expandable: isExpandable?.(item) ?? !!children?.length,
      });
      if (expanded.has(key) && children?.length)
        visit(children, key, depth + 1, new Set([...ancestors, key]));
    });
  };
  visit(items, null, 0, new Set());
  return rows;
}
export type TreeDropPosition = "before" | "inside" | "after";
export interface TreeDropTarget<T> {
  item: T;
  key: CollectionKey;
  position: TreeDropPosition;
}
// Preserve the legacy DragEvent predicate for non-drag moves as well. There is
// no pointer geometry; the source payload matches an internal drag's first key.
function moveDropEvent(sourceKeys: readonly CollectionKey[]): React.DragEvent {
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", String(sourceKeys[0]));
  const nativeEvent = new DragEvent("drop", { dataTransfer, cancelable: true });
  return {
    nativeEvent,
    dataTransfer,
    type: "drop",
    bubbles: false,
    cancelable: true,
    get defaultPrevented() { return nativeEvent.defaultPrevented; },
    eventPhase: nativeEvent.eventPhase,
    isTrusted: false,
    timeStamp: nativeEvent.timeStamp,
    target: nativeEvent.target,
    currentTarget: nativeEvent.currentTarget,
    preventDefault: () => nativeEvent.preventDefault(),
    stopPropagation: () => nativeEvent.stopPropagation(),
    isDefaultPrevented: () => nativeEvent.defaultPrevented,
    isPropagationStopped: () => nativeEvent.cancelBubble,
    persist: () => {},
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    button: 0, buttons: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0,
    screenX: 0, screenY: 0, movementX: 0, movementY: 0, relatedTarget: null,
    detail: 0, view: window,
    getModifierState: () => false,
  } as unknown as React.DragEvent;
}
export interface UseTreeOptions<T>
  extends
    TreeCollectionOptions<T>,
    Omit<UseListboxOptions<T>, "items" | "getKey"> {
  expandedKeys?: readonly CollectionKey[];
  defaultExpandedKeys?: readonly CollectionKey[];
  onExpandedChange?: (keys: CollectionKey[]) => void;
  loadChildren?: (item: T) => Promise<readonly T[]>;
  onLoadError?: (error: unknown, item: T) => void;
  renamingKey?: CollectionKey | null;
  defaultRenamingKey?: CollectionKey | null;
  onRenamingKeyChange?: (key: CollectionKey | null) => void;
  onRename?: (item: T, name: string) => void;
  draggable?: boolean | ((item: T) => boolean);
  onMoveItem?: (sourceKeys: CollectionKey[], targetKey: CollectionKey, position: TreeDropPosition) => void;
  canMove?: (sourceKeys: readonly CollectionKey[], target: TreeDropTarget<T>) => boolean;
  canDrop?: (target: TreeDropTarget<T>, event: React.DragEvent) => boolean;
  onDropItem?: (target: TreeDropTarget<T>, event: React.DragEvent) => void;
  dropTarget?: TreeDropTarget<T> | null;
  defaultDropTarget?: TreeDropTarget<T> | null;
  onDropTargetChange?: (target: TreeDropTarget<T> | null) => void;
  onDragItem?: (item: T, event: React.DragEvent) => void;
}
export function useTree<T>(options: UseTreeOptions<T>) {
  const { items, getKey, getChildren, isExpandable, loadChildren } = options;
  const [expandedKeys, setExpandedKeys] = useControllableState<
    readonly CollectionKey[]
  >({
    value: options.expandedKeys,
    defaultValue: options.defaultExpandedKeys ?? [],
    onChange: (keys) => options.onExpandedChange?.([...keys]),
  });
  const [renamingKey, setRenamingKey] =
    useControllableState<CollectionKey | null>({
      value: options.renamingKey,
      defaultValue: options.defaultRenamingKey ?? null,
      onChange: options.onRenamingKeyChange,
    });
  const [loaded, setLoaded] = React.useState(
    new Map<CollectionKey, readonly T[]>(),
  );
  const [loadingKeys, setLoadingKeys] = React.useState(
    new Set<CollectionKey>(),
  );
  const [loadErrors, setLoadErrors] = React.useState(
    new Map<CollectionKey, unknown>(),
  );
  const pending = React.useRef(new Set<CollectionKey>());
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const childrenOf = (item: T) => getChildren(item) ?? loaded.get(getKey(item));
  const rows = flattenTree(
    { items, getKey, getChildren: childrenOf, isExpandable },
    expandedKeys,
  );
  const selection = useListbox({
    ...options,
    items: rows,
    getKey: (row) => row.key,
    getText: (row) => options.getText?.(row.item) ?? String(row.key),
    isDisabled: (row) => options.isDisabled?.(row.item) ?? false,
  });
  const ensureLoaded = (item: T) => {
    const key = getKey(item);
    if (
      !loadChildren ||
      childrenOf(item) !== undefined ||
      pending.current.has(key)
    )
      return;
    pending.current.add(key);
    setLoadingKeys((keys) => new Set([...keys, key]));
    setLoadErrors((errors) => {
      const next = new Map(errors);
      next.delete(key);
      return next;
    });
    Promise.resolve()
      .then(() => loadChildren(item))
      .then(
        (children) => {
          if (alive.current)
            setLoaded((current) => new Map(current).set(key, children));
        },
        (error) => {
          if (alive.current) {
            setLoadErrors((current) => new Map(current).set(key, error));
            options.onLoadError?.(error, item);
          }
        },
      )
      .finally(() => {
        pending.current.delete(key);
        if (alive.current)
          setLoadingKeys((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
      });
  };
  // Also load controlled/default expanded branches, not just pointer expansions.
  React.useEffect(() => {
    rows.forEach((row) => {
      if (
        expandedKeys.includes(row.key) &&
        row.expandable &&
        !loadErrors.has(row.key)
      )
        ensureLoaded(row.item);
    });
  }, [expandedKeys, items, loaded]);
  const expand = (row: TreeNode<T>, open: boolean) => {
    if (!row.expandable || options.isDisabled?.(row.item)) return;
    setExpandedKeys((keys) =>
      open
        ? [...new Set([...keys, row.key])]
        : keys.filter((key) => key !== row.key),
    );
    if (open) ensureLoaded(row.item);
  };
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const focused = rowByKey.get(selection.focusedKey!);
  const [cutKeys, setCutKeys] = React.useState<CollectionKey[]>([]);
  const draggedKeys = React.useRef<CollectionKey[]>([]);
  const [announcement, setAnnouncement] = React.useState({ text: "", revision: 0 });
  const announce = (text: string) => setAnnouncement((current) => ({ text, revision: current.revision + 1 }));
  const canMoveTo = (sourceKeys: readonly CollectionKey[], target: TreeDropTarget<T>) => {
    if (!sourceKeys.length || sourceKeys.includes(target.key)) return false;
    let parent = rowByKey.get(target.key)?.parentKey;
    while (parent !== null && parent !== undefined) {
      if (sourceKeys.includes(parent)) return false;
      parent = rowByKey.get(parent)?.parentKey;
    }
    return sourceKeys.every((key) => {
      const source = rowByKey.get(key);
      return !!source && !options.isDisabled?.(source.item) &&
        (typeof options.draggable !== "function" || options.draggable(source.item));
    }) && !options.isDisabled?.(target.item) && (options.canMove?.(sourceKeys, target) ?? true);
  };
  const canDropAt = (sourceKeys: readonly CollectionKey[], target: TreeDropTarget<T>, event?: React.DragEvent) =>
    (!sourceKeys.length || canMoveTo(sourceKeys, target)) &&
    (options.canDrop?.(target, event ?? moveDropEvent(sourceKeys)) ?? true);
  const moveItem = (sourceKeys: readonly CollectionKey[], targetKey: CollectionKey, position: TreeDropPosition = "inside", event?: React.DragEvent) => {
    const row = rowByKey.get(targetKey);
    if (!row || !options.onMoveItem || (!sourceKeys.length || !canDropAt(sourceKeys, { item: row.item, key: targetKey, position }, event))) {
      announce("Move unavailable at this target.");
      return false;
    }
    options.onMoveItem([...sourceKeys], targetKey, position);
    setCutKeys([]);
    announce(`Moved ${sourceKeys.length} item${sourceKeys.length === 1 ? "" : "s"} ${position} ${options.getText?.(row.item) ?? String(targetKey)}.`);
    return true;
  };
  const cutItem = (key: CollectionKey) => {
    const keys = selection.selectedKeys.includes(key) ? [...selection.selectedKeys] : [key];
    if (!options.onMoveItem || !keys.every((sourceKey) => {
      const source = rowByKey.get(sourceKey);
      return source && !options.isDisabled?.(source.item) &&
        (typeof options.draggable !== "function" || options.draggable(source.item));
    })) {
      announce("Move unavailable for these items.");
      return false;
    }
    setCutKeys(keys);
    announce(`${keys.length} item${keys.length === 1 ? "" : "s"} marked for move. Choose a target and paste. Escape cancels.`);
    return true;
  };
  const cancelMove = () => { setCutKeys([]); announce("Move cancelled."); };
  const pasteItem = (targetKey: CollectionKey, position: TreeDropPosition = "inside") =>
    moveItem(cutKeys, targetKey, position);
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key === "Escape" && cutKeys.length) {
      event.preventDefault(); cancelMove(); return;
    }
    if (options.onMoveItem && (event.ctrlKey || event.metaKey)) {
      if (event.key.toLowerCase() === "x" && focused) {
        event.preventDefault();
        cutItem(focused.key);
        return;
      }
      if (event.key.toLowerCase() === "v" && cutKeys.length && focused) {
        event.preventDefault();
        moveItem(cutKeys, focused.key, event.shiftKey ? (event.altKey ? "after" : "before") : "inside");
        return;
      }
    }
    if (
      focused &&
      ["ArrowRight", "ArrowLeft", "*", "Enter", "F2"].includes(event.key) &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const action = resolveTreeNavigationAction(event.key, {
          rows: rows.map(row => ({
            key: row.key, depth: row.depth, branch: row.expandable,
            expanded: expandedKeys.includes(row.key),
            label: options.getText?.(row.item) ?? String(row.key), data: row,
            disabled: options.isDisabled?.(row.item) ?? false,
          })),
          focusedKey: focused.key,
        });
        if (action?.type === "focus") selection.setFocusedKey(action.key);
        if (action?.type === "toggle") expand(action.item, !expandedKeys.includes(action.key));
      }
      if (event.key === "*") {
        const siblings = rows.filter(
          (row) =>
            row.parentKey === focused.parentKey &&
            row.expandable &&
            !options.isDisabled?.(row.item),
        );
        setExpandedKeys((keys) => [
          ...new Set([...keys, ...siblings.map((row) => row.key)]),
        ]);
        siblings.forEach((row) => ensureLoaded(row.item));
      }
      if (event.key === "Enter") {
        selection.select(focused.key, event);
        if (focused.expandable)
          expand(focused, !expandedKeys.includes(focused.key));
      }
      if (event.key === "F2" && options.onRename) setRenamingKey(focused.key);
    } else selection.onKeyDown(event);
  };
  const [dropTarget, setDropTarget] =
    useControllableState<TreeDropTarget<T> | null>({
      value: options.dropTarget,
      defaultValue: options.defaultDropTarget ?? null,
      onChange: options.onDropTargetChange,
    });
  const getDragProps = (row: TreeNode<T>) => ({
    draggable:
      typeof options.draggable === "function"
        ? options.draggable(row.item)
        : options.draggable,
    "data-drop-target": dropTarget?.key === row.key ? "" : undefined,
    "data-drop-position":
      dropTarget?.key === row.key ? dropTarget.position : undefined,
    onDragStart: (event: React.DragEvent) => {
      draggedKeys.current = selection.selectedKeys.includes(row.key) ? [...selection.selectedKeys] : [row.key];
      event.dataTransfer.setData("text/plain", String(row.key));
      options.onDragItem?.(row.item, event);
    },
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      if (!options.onDropItem && !options.onMoveItem) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const fraction =
        (event.clientY - bounds.top) / Math.max(1, bounds.height);
      const target: TreeDropTarget<T> = {
        key: row.key,
        item: row.item,
        position:
          fraction < 0.25 ? "before" : fraction > 0.75 ? "after" : "inside",
      };
      if (!canDropAt(draggedKeys.current, target, event)) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      setDropTarget(target);
    },
    onDragLeave: (event: React.DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        setDropTarget(null);
    },
    onDrop: (event: React.DragEvent) => {
      if (dropTarget?.key === row.key) {
        if (options.onDropItem) {
          if (canDropAt(draggedKeys.current, dropTarget, event)) {
            event.preventDefault();
            options.onDropItem(dropTarget, event);
          }
        } else if (moveItem(draggedKeys.current, dropTarget.key, dropTarget.position, event)) {
          event.preventDefault();
        }
      }
      setDropTarget(null);
    },
    onDragEnd: () => { draggedKeys.current = []; setDropTarget(null); },
  });
  return {
    ...selection,
    getItemProps: (row: TreeNode<T>) => ({
      ...selection.getItemProps(row, false),
      "data-cut": cutKeys.includes(row.key) ? "" : undefined,
      role: "treeitem",
      "aria-level": row.depth + 1,
      "aria-posinset": row.posInSet,
      "aria-setsize": row.setSize,
      "aria-expanded": row.expandable
        ? expandedKeys.includes(row.key)
        : undefined,
      "aria-busy": loadingKeys.has(row.key) || undefined,
    }),
    rows,
    moveItem,
    cutItem,
    pasteItem,
    cancelMove,
    cutKeys,
    announcement,
    expandedKeys,
    setExpandedKeys,
    expand,
    loadingKeys,
    loadErrors,
    retryLoad: ensureLoaded,
    renamingKey,
    setRenamingKey,
    commitRename: (item: T, name: string) => {
      options.onRename?.(item, name);
      setRenamingKey(null);
    },
    dropTarget,
    setDropTarget,
    getDragProps,
    onKeyDown,
    getRootProps: () => ({
      ...selection.getRootProps(),
      role: "tree",
      onKeyDown,
    }),
  };
}
export const treeVariants = cva("onyx-tree");
export interface TreeProps<T>
  extends
    Omit<
      React.HTMLAttributes<HTMLDivElement>,
      "children" | "onChange" | "draggable"
    >,
    UseTreeOptions<T> {
  children?: React.ReactElement;
  renderItem?: (
    item: T,
    state: {
      selected: boolean;
      focused: boolean;
      expanded: boolean;
      loading: boolean;
      depth: number;
    },
  ) => React.ReactNode;
  renderRename?: (
    item: T,
    actions: { commit: (name: string) => void; cancel: () => void },
  ) => React.ReactNode;
  virtualized?: boolean;
  rowHeight?: number;
  overscan?: number;
  onRenderedRangeChange?: (count: number, total: number) => void;
  asChild?: boolean;
}
function TreeImpl<T>(
  {
    className,
    children,
    renderItem,
    renderRename,
    virtualized = false,
    rowHeight,
    overscan,
    onRenderedRangeChange,
    asChild,
    onKeyDown,
    style,
    ...options
  }: TreeProps<T>,
  forwardedRef: React.ForwardedRef<HTMLDivElement>,
) {
  const model = useTree(options);
  const list = useVirtualList({
    count: model.rows.length,
    getKey: (index) =>
      `${typeof model.rows[index]!.key}:${model.rows[index]!.key}`,
    enabled: virtualized,
    rowHeight,
    overscan,
    activeIndex: model.rows.findIndex((row) => row.key === model.focusedKey),
  });
  const ref = useComposedRefs(forwardedRef, list.ref);
  React.useEffect(() => {
    onRenderedRangeChange?.(
      virtualized ? list.virtualItems.length : model.rows.length,
      model.rows.length,
    );
  }, [
    list.virtualItems.length,
    model.rows.length,
    virtualized,
    onRenderedRangeChange,
  ]);
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
  const render = (row: TreeNode<T>) => {
    const expanded = model.expandedKeys.includes(row.key);
    const loading = model.loadingKeys.has(row.key);
    return (
      <TreeRow
        key={`${typeof row.key}:${row.key}`}
        data-slot="tree-item"
        {...model.getItemProps(row)}
        {...model.getDragProps(row)}
        aria-level={row.depth + 1}
        aria-posinset={row.posInSet}
        aria-setsize={row.setSize}
        aria-expanded={row.expandable ? expanded : undefined}
        aria-busy={loading || undefined}
        data-depth-guide={row.depth > 0 ? "" : undefined}
        data-renaming={model.renamingKey === row.key ? "" : undefined}
        data-state={loading ? "loading" : expanded ? "expanded" : "collapsed"}
        style={{ "--onyx-tree-depth": row.depth } as React.CSSProperties}
      >
        <span
          data-slot="tree-twisty"
          aria-hidden="true"
          onClick={(event) => {
            if (row.expandable) {
              event.stopPropagation();
              model.expand(row, !expanded);
              model.setFocusedKey(row.key);
              list.ref.current?.focus();
            }
          }}
        >
          {row.expandable && (
            <Icon
              name={
                loading
                  ? "loading"
                  : expanded
                    ? "chevron-down"
                    : "chevron-right"
              }
            />
          )}
        </span>
        {model.renamingKey === row.key && renderRename ? (
          <span
            data-slot="tree-rename"
            onClick={(event) => event.stopPropagation()}
          >
            {renderRename(row.item, {
              commit: (name) => {
                model.commitRename(row.item, name);
                list.ref.current?.focus();
              },
              cancel: () => {
                model.setRenamingKey(null);
                list.ref.current?.focus();
              },
            })}
          </span>
        ) : (
          (renderItem?.(row.item, {
            selected: model.selectedKeys.includes(row.key),
            focused: model.focusedKey === row.key,
            expanded,
            loading,
            depth: row.depth,
          }) ??
          options.getText?.(row.item) ??
          String(row.key))
        )}
      </TreeRow>
    );
  };
  const {
    items,
    getKey,
    getChildren,
    getText,
    isDisabled,
    isExpandable,
    selectionMode,
    selectedKeys,
    defaultSelectedKeys,
    onSelectionChange,
    focusedKey,
    defaultFocusedKey,
    onFocusChange,
    expandedKeys,
    defaultExpandedKeys,
    onExpandedChange,
    loadChildren,
    onLoadError,
    renamingKey,
    defaultRenamingKey,
    onRenamingKeyChange,
    onRename,
    draggable,
    canDrop,
    canMove,
    onMoveItem,
    onDropItem,
    onDragItem,
    dropTarget,
    defaultDropTarget,
    onDropTargetChange,
    ...htmlProps
  } = options;
  const Component = asChild ? Slot : "div";
  const rowContent = virtualized ? (
    <div
      data-slot="tree-content"
      style={{ height: list.totalSize, position: "relative" }}
    >
      {list.virtualItems.map((v) => (
        <div
          key={v.key}
          data-slot="tree-virtual-row"
          style={{ position: "absolute", top: v.start, width: "100%" }}
        >
          {render(model.rows[v.index]!)}
        </div>
      ))}
    </div>
  ) : (
    model.rows.map(render)
  );
  const content = <>{rowContent}<span data-slot="tree-announcer" className="sr-only" role="status" aria-live="polite" aria-atomic="true"><span key={model.announcement.revision}>{model.announcement.text}</span></span></>;
  const target = model.rows.find((row) => row.key === model.focusedKey);
  return (
    <>
      {options.onMoveItem && (
        <div data-slot="tree-move-actions" role="group" aria-label={`Move actions${target ? ` for ${options.getText?.(target.item) ?? String(target.key)}` : ""}`}>
          <span data-slot="tree-move-target">{target ? `Target: ${options.getText?.(target.item) ?? String(target.key)}` : "Select a row"}</span>
          <Button size="sm" variant="ghost" disabled={!target || !!options.isDisabled?.(target.item) || (typeof options.draggable === "function" && !options.draggable(target.item))} onClick={() => target && model.cutItem(target.key)}>Cut</Button>
          {(["before", "inside", "after"] as const).map((position) => (
            <Button key={position} size="sm" variant="ghost" disabled={!target || !model.cutKeys.length} onClick={() => target && model.pasteItem(target.key, position)}>Paste {position}</Button>
          ))}
          <Button size="sm" variant="ghost" disabled={!model.cutKeys.length} onClick={model.cancelMove}>Cancel move</Button>
        </div>
      )}
    <Component
      ref={ref}
      data-slot="tree"
      data-orientation="vertical"
      className={cn(treeVariants(), className)}
      style={{ ...style, ...(rowHeight === undefined ? {} : { "--onyx-row-height": `${rowHeight}px` }) } as React.CSSProperties}
      {...htmlProps}
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
    </>
  );
}
export const Tree = React.forwardRef(TreeImpl) as <T>(
  props: TreeProps<T> & React.RefAttributes<HTMLDivElement>,
) => React.ReactElement;
