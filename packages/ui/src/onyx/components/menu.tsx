/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { usePortalContainer } from "./popover";
import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import * as P from "@radix-ui/react-dropdown-menu";
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
export const Menu = P.Root;
export function MenuPortal({ container, ...props }: React.ComponentPropsWithoutRef<typeof P.Portal>) {
  const host = usePortalContainer(container);
  return <P.Portal container={host} {...props} />;
}
export const MenuSub = P.Sub;
export const MenuTrigger = React.forwardRef<
  React.ElementRef<typeof P.Trigger>,
  React.ComponentPropsWithoutRef<typeof P.Trigger>
>(({ className, ...props }, ref) => (
  <P.Trigger
    ref={ref}
    data-slot="menu-trigger"
    className={cn("", className)}
    {...props}
  />
));
MenuTrigger.displayName = "MenuTrigger";
export const MenuGroup = React.forwardRef<
  React.ElementRef<typeof P.Group>,
  React.ComponentPropsWithoutRef<typeof P.Group>
>(({ className, ...props }, ref) => (
  <P.Group
    ref={ref}
    data-slot="menu-group"
    className={cn("", className)}
    {...props}
  />
));
MenuGroup.displayName = "MenuGroup";
export const MenuRadioGroup = React.forwardRef<
  React.ElementRef<typeof P.RadioGroup>,
  React.ComponentPropsWithoutRef<typeof P.RadioGroup>
>(({ className, ...props }, ref) => (
  <P.RadioGroup
    ref={ref}
    data-slot="menu-radiogroup"
    className={cn("", className)}
    {...props}
  />
));
MenuRadioGroup.displayName = "MenuRadioGroup";
export const MenuContent = React.forwardRef<
  React.ElementRef<typeof P.Content>,
  React.ComponentPropsWithoutRef<typeof P.Content> & {
    container?: HTMLElement | null | undefined;
  }
>(
  (
    { className, container, sideOffset = 4, collisionPadding = 8, ...props },
    ref,
  ) => {
    const portalContainer = usePortalContainer(container);
    return (
    <P.Portal container={portalContainer}>
      <P.Content
        ref={ref}
        data-slot="menu-content"
        className={cn(menuContentVariants(), className)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
      />
    </P.Portal>
    );
  },
);
MenuContent.displayName = "MenuContent";
export const MenuSubContent = React.forwardRef<
  React.ElementRef<typeof P.SubContent>,
  React.ComponentPropsWithoutRef<typeof P.SubContent> & {
    container?: HTMLElement | null | undefined;
  }
>(
  (
    { className, container, sideOffset = 4, collisionPadding = 8, ...props },
    ref,
  ) => {
    const portalContainer = usePortalContainer(container);
    return (
    <P.Portal container={portalContainer}>
      <P.SubContent
        ref={ref}
        data-slot="menu-sub-content"
        className={cn(menuContentVariants(), className)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
      />
    </P.Portal>
    );
  },
);
MenuSubContent.displayName = "MenuSubContent";
export const MenuItem = React.forwardRef<
  React.ElementRef<typeof P.Item>,
  React.ComponentPropsWithoutRef<typeof P.Item> & {
    inset?: boolean | undefined;
    tone?: "neutral" | "danger" | undefined;
  }
>(({ className, inset, tone, children, ...props }, ref) => (
  <P.Item
    ref={ref}
    data-slot="menu-item"
    data-tone={tone}
    className={cn(menuItemVariants({ inset, tone }), className)}
    {...props}
  >
    {children}
  </P.Item>
));
MenuItem.displayName = "MenuItem";
export const MenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof P.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof P.SubTrigger> & {
    inset?: boolean | undefined;
    tone?: "neutral" | "danger" | undefined;
  }
>(({ className, inset, tone, children, ...props }, ref) => (
  <P.SubTrigger
    ref={ref}
    data-slot="menu-sub-trigger"
    data-tone={tone}
    className={cn(menuItemVariants({ inset, tone }), className)}
    {...props}
  >
    {itemContent(
      children,
      <Icon
        data-slot="menu-submenu-icon"
        name="chevron-right"
        className="onyx-menu-shortcut"
      />,
      props.asChild,
    )}
  </P.SubTrigger>
));
MenuSubTrigger.displayName = "MenuSubTrigger";
export const MenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof P.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof P.CheckboxItem>
>(({ className, ...props }, ref) => (
  <P.CheckboxItem
    ref={ref}
    data-slot="menu-checkbox-item"
    className={cn(menuItemVariants({ inset: true }), className)}
    {...props}
  >
    {itemContent(
      props.children,
      <span data-slot="menu-indicator" className="onyx-menu-indicator">
        <P.ItemIndicator>
          <Icon name="check" size="sm" />
        </P.ItemIndicator>
      </span>,
      props.asChild,
      true,
    )}
  </P.CheckboxItem>
));
MenuCheckboxItem.displayName = "MenuCheckboxItem";
export const MenuRadioItem = React.forwardRef<
  React.ElementRef<typeof P.RadioItem>,
  React.ComponentPropsWithoutRef<typeof P.RadioItem>
>(({ className, ...props }, ref) => (
  <P.RadioItem
    ref={ref}
    data-slot="menu-radio-item"
    className={cn(menuItemVariants({ inset: true }), className)}
    {...props}
  >
    {itemContent(
      props.children,
      <span data-slot="menu-indicator" className="onyx-menu-indicator">
        <P.ItemIndicator>
          <Icon name="primitive-dot" size="sm" />
        </P.ItemIndicator>
      </span>,
      props.asChild,
      true,
    )}
  </P.RadioItem>
));
MenuRadioItem.displayName = "MenuRadioItem";
export const MenuLabel = React.forwardRef<
  React.ElementRef<typeof P.Label>,
  React.ComponentPropsWithoutRef<typeof P.Label> & { inset?: boolean | undefined }
>(({ className, inset, ...props }, ref) => (
  <P.Label
    ref={ref}
    data-slot="menu-label"
    className={cn(menuLabelVariants({ inset }), className)}
    {...props}
  />
));
MenuLabel.displayName = "MenuLabel";
export const MenuSeparator = React.forwardRef<
  React.ElementRef<typeof P.Separator>,
  React.ComponentPropsWithoutRef<typeof P.Separator>
>(({ className, ...props }, ref) => (
  <P.Separator
    ref={ref}
    data-slot="menu-separator"
    className={cn(menuSeparatorVariants(), className)}
    {...props}
  />
));
MenuSeparator.displayName = "MenuSeparator";
export const MenuShortcut = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      ref={ref}
      data-slot="menu-shortcut"
      className={cn(menuShortcutVariants(), className)}
      {...props}
    />
  );
});
MenuShortcut.displayName = "MenuShortcut";
