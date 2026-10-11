/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import * as P from "@radix-ui/react-context-menu";
import { Icon } from "./icon";
import {
  menuContentVariants,
  menuItemVariants,
  menuLabelVariants,
  menuSeparatorVariants,
  menuShortcutVariants,
} from "../lib/menu-styles";
export {
  menuContentVariants,
  menuItemVariants,
  menuLabelVariants,
  menuSeparatorVariants,
  menuShortcutVariants,
} from "../lib/menu-styles";

function itemContent(
  children: React.ReactNode,
  adornment: React.ReactNode,
  asChild?: boolean,
  leading = false,
) {
  const child =
    asChild && React.isValidElement(children)
      ? (children as React.ReactElement<{ children?: React.ReactNode | undefined }>)
      : undefined;
  const label = child ? child.props.children : children;
  const content = leading ? (
    <>
      {adornment}
      {label}
    </>
  ) : (
    <>
      {label}
      {adornment}
    </>
  );
  return child ? React.cloneElement(child, {}, content) : content;
}
export const ContextMenu = P.Root;
export const ContextMenuPortal = P.Portal;
export const ContextMenuSub = P.Sub;
export const ContextMenuTrigger = React.forwardRef<
  React.ElementRef<typeof P.Trigger>,
  React.ComponentPropsWithoutRef<typeof P.Trigger>
>(({ className, ...props }, ref) => (
  <P.Trigger
    ref={ref}
    data-slot="context-menu-trigger"
    className={cn("", className)}
    {...props}
  />
));
ContextMenuTrigger.displayName = "ContextMenuTrigger";
export const ContextMenuGroup = React.forwardRef<
  React.ElementRef<typeof P.Group>,
  React.ComponentPropsWithoutRef<typeof P.Group>
>(({ className, ...props }, ref) => (
  <P.Group
    ref={ref}
    data-slot="context-menu-group"
    className={cn("", className)}
    {...props}
  />
));
ContextMenuGroup.displayName = "ContextMenuGroup";
export const ContextMenuRadioGroup = React.forwardRef<
  React.ElementRef<typeof P.RadioGroup>,
  React.ComponentPropsWithoutRef<typeof P.RadioGroup>
>(({ className, ...props }, ref) => (
  <P.RadioGroup
    ref={ref}
    data-slot="context-menu-radiogroup"
    className={cn("", className)}
    {...props}
  />
));
ContextMenuRadioGroup.displayName = "ContextMenuRadioGroup";
export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof P.Content>,
  React.ComponentPropsWithoutRef<typeof P.Content> & {
    container?: HTMLElement | null | undefined;
  }
>(({ className, container, collisionPadding = 8, ...props }, ref) => (
  <P.Portal container={container}>
    <P.Content
      ref={ref}
      data-slot="context-menu-content"
      className={cn(menuContentVariants(), className)}
      collisionPadding={collisionPadding}
      {...props}
    />
  </P.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";
export const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof P.SubContent>,
  React.ComponentPropsWithoutRef<typeof P.SubContent> & {
    container?: HTMLElement | null | undefined;
  }
>(({ className, container, collisionPadding = 8, ...props }, ref) => (
  <P.Portal container={container}>
    <P.SubContent
      ref={ref}
      data-slot="context-menu-sub-content"
      className={cn(menuContentVariants(), className)}
      collisionPadding={collisionPadding}
      {...props}
    />
  </P.Portal>
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";
export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof P.Item>,
  React.ComponentPropsWithoutRef<typeof P.Item> & {
    inset?: boolean | undefined;
    tone?: "neutral" | "danger" | undefined;
  }
>(({ className, inset, tone, children, ...props }, ref) => (
  <P.Item
    ref={ref}
    data-slot="context-menu-item"
    data-tone={tone}
    className={cn(menuItemVariants({ inset, tone }), className)}
    {...props}
  >
    {children}
  </P.Item>
));
ContextMenuItem.displayName = "ContextMenuItem";
export const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof P.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof P.SubTrigger> & {
    inset?: boolean | undefined;
    tone?: "neutral" | "danger" | undefined;
  }
>(({ className, inset, tone, children, ...props }, ref) => (
  <P.SubTrigger
    ref={ref}
    data-slot="context-menu-sub-trigger"
    data-tone={tone}
    className={cn(menuItemVariants({ inset, tone }), className)}
    {...props}
  >
    {itemContent(
      children,
      <Icon
        data-slot="context-menu-submenu-icon"
        name="chevron-right"
        className="onyx-menu-shortcut"
      />,
      props.asChild,
    )}
  </P.SubTrigger>
));
ContextMenuSubTrigger.displayName = "ContextMenuSubTrigger";
export const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof P.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof P.CheckboxItem>
>(({ className, ...props }, ref) => (
  <P.CheckboxItem
    ref={ref}
    data-slot="context-menu-checkbox-item"
    className={cn(menuItemVariants({ inset: true }), className)}
    {...props}
  >
    {itemContent(
      props.children,
      <span data-slot="context-menu-indicator" className="onyx-menu-indicator">
        <P.ItemIndicator>
          <Icon name="check" size="sm" />
        </P.ItemIndicator>
      </span>,
      props.asChild,
      true,
    )}
  </P.CheckboxItem>
));
ContextMenuCheckboxItem.displayName = "ContextMenuCheckboxItem";
export const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof P.RadioItem>,
  React.ComponentPropsWithoutRef<typeof P.RadioItem>
>(({ className, ...props }, ref) => (
  <P.RadioItem
    ref={ref}
    data-slot="context-menu-radio-item"
    className={cn(menuItemVariants({ inset: true }), className)}
    {...props}
  >
    {itemContent(
      props.children,
      <span data-slot="context-menu-indicator" className="onyx-menu-indicator">
        <P.ItemIndicator>
          <Icon name="primitive-dot" size="sm" />
        </P.ItemIndicator>
      </span>,
      props.asChild,
      true,
    )}
  </P.RadioItem>
));
ContextMenuRadioItem.displayName = "ContextMenuRadioItem";
export const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof P.Label>,
  React.ComponentPropsWithoutRef<typeof P.Label> & { inset?: boolean | undefined }
>(({ className, inset, ...props }, ref) => (
  <P.Label
    ref={ref}
    data-slot="context-menu-label"
    className={cn(menuLabelVariants({ inset }), className)}
    {...props}
  />
));
ContextMenuLabel.displayName = "ContextMenuLabel";
export const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof P.Separator>,
  React.ComponentPropsWithoutRef<typeof P.Separator>
>(({ className, ...props }, ref) => (
  <P.Separator
    ref={ref}
    data-slot="context-menu-separator"
    className={cn(menuSeparatorVariants(), className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";
export const ContextMenuShortcut = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      ref={ref}
      data-slot="context-menu-shortcut"
      className={cn(menuShortcutVariants(), className)}
      {...props}
    />
  );
});
ContextMenuShortcut.displayName = "ContextMenuShortcut";
