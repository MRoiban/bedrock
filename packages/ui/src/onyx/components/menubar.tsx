/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { usePortalContainer } from "./popover";
import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import * as P from "@radix-ui/react-menubar";
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
export const menubarVariants = cva("onyx-menubar");
export const Menubar = React.forwardRef<
  React.ElementRef<typeof P.Root>,
  React.ComponentPropsWithoutRef<typeof P.Root>
>(({ className, ...props }, ref) => (
  <P.Root
    ref={ref}
    data-slot="menubar"
    className={cn(menubarVariants(), className)}
    {...props}
  />
));
Menubar.displayName = "Menubar";
export const MenubarMenu = P.Menu;
export function MenubarPortal({ container, ...props }: React.ComponentPropsWithoutRef<typeof P.Portal>) {
  const host = usePortalContainer(container);
  return <P.Portal container={host} {...props} />;
}
export const MenubarSub = P.Sub;
export const MenubarTrigger = React.forwardRef<
  React.ElementRef<typeof P.Trigger>,
  React.ComponentPropsWithoutRef<typeof P.Trigger>
>(({ className, ...props }, ref) => (
  <P.Trigger
    ref={ref}
    data-slot="menubar-trigger"
    className={cn("onyx-menubar-trigger", className)}
    {...props}
  />
));
MenubarTrigger.displayName = "MenubarTrigger";
export const MenubarGroup = React.forwardRef<
  React.ElementRef<typeof P.Group>,
  React.ComponentPropsWithoutRef<typeof P.Group>
>(({ className, ...props }, ref) => (
  <P.Group
    ref={ref}
    data-slot="menubar-group"
    className={cn("", className)}
    {...props}
  />
));
MenubarGroup.displayName = "MenubarGroup";
export const MenubarRadioGroup = React.forwardRef<
  React.ElementRef<typeof P.RadioGroup>,
  React.ComponentPropsWithoutRef<typeof P.RadioGroup>
>(({ className, ...props }, ref) => (
  <P.RadioGroup
    ref={ref}
    data-slot="menubar-radiogroup"
    className={cn("", className)}
    {...props}
  />
));
MenubarRadioGroup.displayName = "MenubarRadioGroup";
export const MenubarContent = React.forwardRef<
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
        data-slot="menubar-content"
        className={cn(menuContentVariants(), className)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
      />
    </P.Portal>
    );
  },
);
MenubarContent.displayName = "MenubarContent";
export const MenubarSubContent = React.forwardRef<
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
        data-slot="menubar-sub-content"
        className={cn(menuContentVariants(), className)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
      />
    </P.Portal>
    );
  },
);
MenubarSubContent.displayName = "MenubarSubContent";
export const MenubarItem = React.forwardRef<
  React.ElementRef<typeof P.Item>,
  React.ComponentPropsWithoutRef<typeof P.Item> & {
    inset?: boolean | undefined;
    tone?: "neutral" | "danger" | undefined;
  }
>(({ className, inset, tone, children, ...props }, ref) => (
  <P.Item
    ref={ref}
    data-slot="menubar-item"
    data-tone={tone}
    className={cn(menuItemVariants({ inset, tone }), className)}
    {...props}
  >
    {children}
  </P.Item>
));
MenubarItem.displayName = "MenubarItem";
export const MenubarSubTrigger = React.forwardRef<
  React.ElementRef<typeof P.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof P.SubTrigger> & {
    inset?: boolean | undefined;
    tone?: "neutral" | "danger" | undefined;
  }
>(({ className, inset, tone, children, ...props }, ref) => (
  <P.SubTrigger
    ref={ref}
    data-slot="menubar-sub-trigger"
    data-tone={tone}
    className={cn(menuItemVariants({ inset, tone }), className)}
    {...props}
  >
    {itemContent(
      children,
      <Icon
        data-slot="menubar-submenu-icon"
        name="chevron-right"
        className="onyx-menu-shortcut"
      />,
      props.asChild,
    )}
  </P.SubTrigger>
));
MenubarSubTrigger.displayName = "MenubarSubTrigger";
export const MenubarCheckboxItem = React.forwardRef<
  React.ElementRef<typeof P.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof P.CheckboxItem>
>(({ className, ...props }, ref) => (
  <P.CheckboxItem
    ref={ref}
    data-slot="menubar-checkbox-item"
    className={cn(menuItemVariants({ inset: true }), className)}
    {...props}
  >
    {itemContent(
      props.children,
      <span data-slot="menubar-indicator" className="onyx-menu-indicator">
        <P.ItemIndicator>
          <Icon name="check" size="sm" />
        </P.ItemIndicator>
      </span>,
      props.asChild,
      true,
    )}
  </P.CheckboxItem>
));
MenubarCheckboxItem.displayName = "MenubarCheckboxItem";
export const MenubarRadioItem = React.forwardRef<
  React.ElementRef<typeof P.RadioItem>,
  React.ComponentPropsWithoutRef<typeof P.RadioItem>
>(({ className, ...props }, ref) => (
  <P.RadioItem
    ref={ref}
    data-slot="menubar-radio-item"
    className={cn(menuItemVariants({ inset: true }), className)}
    {...props}
  >
    {itemContent(
      props.children,
      <span data-slot="menubar-indicator" className="onyx-menu-indicator">
        <P.ItemIndicator>
          <Icon name="primitive-dot" size="sm" />
        </P.ItemIndicator>
      </span>,
      props.asChild,
      true,
    )}
  </P.RadioItem>
));
MenubarRadioItem.displayName = "MenubarRadioItem";
export const MenubarLabel = React.forwardRef<
  React.ElementRef<typeof P.Label>,
  React.ComponentPropsWithoutRef<typeof P.Label> & { inset?: boolean | undefined }
>(({ className, inset, ...props }, ref) => (
  <P.Label
    ref={ref}
    data-slot="menubar-label"
    className={cn(menuLabelVariants({ inset }), className)}
    {...props}
  />
));
MenubarLabel.displayName = "MenubarLabel";
export const MenubarSeparator = React.forwardRef<
  React.ElementRef<typeof P.Separator>,
  React.ComponentPropsWithoutRef<typeof P.Separator>
>(({ className, ...props }, ref) => (
  <P.Separator
    ref={ref}
    data-slot="menubar-separator"
    className={cn(menuSeparatorVariants(), className)}
    {...props}
  />
));
MenubarSeparator.displayName = "MenubarSeparator";
export const MenubarShortcut = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      ref={ref}
      data-slot="menubar-shortcut"
      className={cn(menuShortcutVariants(), className)}
      {...props}
    />
  );
});
MenubarShortcut.displayName = "MenubarShortcut";
