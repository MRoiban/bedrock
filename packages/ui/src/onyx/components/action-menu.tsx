/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { useComposedRefs } from "../lib/compose-refs";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "./menu";

export interface ActionMenuItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  shortcut?: React.ReactNode;
  disabled?: boolean | undefined;
  group?: string | undefined;
  items?: readonly ActionMenuItem[] | undefined;
  onSelect?: React.ComponentPropsWithoutRef<typeof MenuItem>["onSelect"];
}

export interface ActionMenuProps {
  open: boolean;
  /** Viewport coordinates, such as PointerEvent.clientX/clientY. */
  point: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
  items: readonly ActionMenuItem[];
  "aria-label"?: string | undefined;
  className?: string | undefined;
  container?: HTMLElement | null | undefined;
}

function ActionItems({ items, container }: { items: readonly ActionMenuItem[]; container: HTMLElement | null | undefined }) {
  const groups: { label: string | undefined; items: ActionMenuItem[] }[] = [];
  for (const item of items) {
    const previous = groups[groups.length - 1];
    if (previous && previous.label === item.group) previous.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups.map(({ label, items: groupItems }) => (
    <MenuGroup key={groupItems[0]!.id} aria-label={label}>
      {label && <MenuLabel>{label}</MenuLabel>}
      {groupItems.map((item) => {
        const children = (
          <>
            {item.icon}
            <span>{item.label}</span>
            {item.shortcut != null && <MenuShortcut>{item.shortcut}</MenuShortcut>}
          </>
        );
        return item.items?.length ? (
          <MenuSub key={item.id}>
            <MenuSubTrigger disabled={!!item.disabled}>{children}</MenuSubTrigger>
            <MenuSubContent {...(container === undefined ? {} : { container })} aria-label={typeof item.label === "string" ? item.label : undefined}>
              <ActionItems items={item.items} container={container} />
            </MenuSubContent>
          </MenuSub>
        ) : (
          <MenuItem key={item.id} disabled={!!item.disabled} {...(item.onSelect ? { onSelect: item.onSelect } : {})}>
            {children}
          </MenuItem>
        );
      })}
    </MenuGroup>
  ));
}

/** A command menu opened by application state at a viewport point. */
export const ActionMenu = React.forwardRef<HTMLDivElement, ActionMenuProps>(
  ({ open, point, onOpenChange, items, "aria-label": label = "Actions", className, container }, forwardedRef) => {
    const content = React.useRef<HTMLDivElement>(null);
    const lastContent = React.useRef<HTMLDivElement>(null);
    const restoreFocus = React.useRef<HTMLElement | null>(null);
    const outsideInteraction = React.useRef(false);
    const initialized = React.useRef(false);
    const isOpen = React.useRef(open);
    isOpen.current = open;
    const focusMenu = React.useCallback((node: HTMLDivElement) => {
      if (!isOpen.current || initialized.current) return;
      initialized.current = true;
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      outsideInteraction.current = false;
      const first = node.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])');
      (first ?? node).focus({ preventScroll: true });
    }, []);
    const setContent = React.useCallback((node: HTMLDivElement | null) => {
      content.current = node;
      // The portal attaches after its first render. Move focus before Radix's
      // FocusScope effect so it preserves the application control as origin.
      if (node) { lastContent.current = node; focusMenu(node); }
    }, [focusMenu]);
    const ref = useComposedRefs(forwardedRef, setContent);
    React.useLayoutEffect(() => {
      if (!open) initialized.current = false;
      else if (content.current) focusMenu(content.current);
    }, [open, focusMenu]);

    return (
      <Menu open={open} onOpenChange={onOpenChange} modal={false}>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            style={{ position: "fixed", left: `clamp(8px, ${point.x}px, calc(100vw - 8px))`,
              top: `clamp(8px, ${point.y}px, calc(100vh - 8px))`, width: 0, height: 0,
              padding: 0, border: 0, overflow: "hidden", visibility: "hidden", pointerEvents: "none" }}
          />
        </MenuTrigger>
        <MenuContent
          ref={ref}
          data-slot="action-menu"
          aria-label={label}
          aria-labelledby={undefined}
          className={className}
          {...(container === undefined ? {} : { container })}
          align="start"
          sideOffset={0}
          loop
          onInteractOutside={() => { outsideInteraction.current = true; }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const active = document.activeElement;
            // A command may have opened and focused a new control (for example
            // an inline rename field). Preserve that deliberate focus handoff.
            const ownsFocus = active === document.body || active === restoreFocus.current ||
              (active instanceof Node && lastContent.current?.contains(active));
            if (!outsideInteraction.current && ownsFocus && restoreFocus.current?.isConnected) {
              restoreFocus.current.focus({ preventScroll: true });
            }
          }}
        >
          <ActionItems items={items} container={container} />
        </MenuContent>
      </Menu>
    );
  },
);
ActionMenu.displayName = "ActionMenu";
