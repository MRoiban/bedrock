/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { usePortalContainer } from "./popover";
import * as React from "react";
import { createPortal } from "react-dom";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import * as P from "@radix-ui/react-navigation-menu";
import { useFloatingPosition } from "../lib/use-floating-position";
import { useComposedRefs } from "../lib/compose-refs";
const NavigationItemContext =
  React.createContext<React.RefObject<HTMLButtonElement | null> | null>(null);
export const navigationMenuVariants = cva("onyx-navigation-menu");
export const NavigationMenu = React.forwardRef<
  React.ElementRef<typeof P.Root>,
  React.ComponentPropsWithoutRef<typeof P.Root>
>(({ className, ...props }, ref) => (
  <P.Root
    ref={ref}
    data-slot="navigation-menu"
    className={cn(navigationMenuVariants(), className)}
    {...props}
  />
));
NavigationMenu.displayName = "NavigationMenu";
export const NavigationMenuList = React.forwardRef<
  React.ElementRef<typeof P.List>,
  React.ComponentPropsWithoutRef<typeof P.List>
>(({ className, ...props }, ref) => (
  <P.List
    ref={ref}
    data-slot="navigation-menu-list"
    className={cn("onyx-navigation-list", className)}
    {...props}
  />
));
NavigationMenuList.displayName = "NavigationMenuList";
export const NavigationMenuItem = React.forwardRef<
  React.ElementRef<typeof P.Item>,
  React.ComponentPropsWithoutRef<typeof P.Item>
>(({ className, ...props }, ref) => {
  const trigger = React.useRef<HTMLButtonElement>(null);
  return (
    <NavigationItemContext.Provider value={trigger}>
      <P.Item
        ref={ref}
        data-slot="navigation-menu-item"
        className={cn("onyx-navigation-item", className)}
        {...props}
      />
    </NavigationItemContext.Provider>
  );
});
NavigationMenuItem.displayName = "NavigationMenuItem";
export const NavigationMenuTrigger = React.forwardRef<
  React.ElementRef<typeof P.Trigger>,
  React.ComponentPropsWithoutRef<typeof P.Trigger>
>(({ className, ...props }, ref) => {
  const trigger = React.useContext(NavigationItemContext);
  const composed = useComposedRefs(ref, trigger);
  return (
    <P.Trigger
      ref={composed}
      data-slot="navigation-menu-trigger"
      className={cn("onyx-navigation-trigger", className)}
      {...props}
    />
  );
});
NavigationMenuTrigger.displayName = "NavigationMenuTrigger";
export const NavigationMenuContent = React.forwardRef<
  React.ElementRef<typeof P.Content>,
  React.ComponentPropsWithoutRef<typeof P.Content> & { container?: HTMLElement | null | undefined }
>(({ className, style, container, ...props }, ref) => {
  const portalContainer = usePortalContainer(container);
  const trigger = React.useContext(NavigationItemContext);
  const floating = useFloatingPosition({
    open: true,
    offset: 4,
    matchWidth: true,
  });
  const composed = useComposedRefs(ref, floating.refs.setFloating);
  React.useLayoutEffect(() => {
    floating.refs.setReference(
      trigger?.current?.closest<HTMLElement>('[data-slot="navigation-menu"]') ??
        trigger?.current ??
        null,
    );
  }, [trigger, floating.refs]);
  return typeof document === "undefined"
    ? null
    : createPortal(
        <P.Content
          ref={composed}
          data-slot="navigation-menu-content"
          data-side={floating.placement.split("-")[0]}
          className={cn("onyx-navigation-content", className)}
          style={{ ...floating.floatingStyles, ...style }}
          {...props}
        />,
        portalContainer ?? document.body,
      );
});
NavigationMenuContent.displayName = "NavigationMenuContent";
export const NavigationMenuLink = React.forwardRef<
  React.ElementRef<typeof P.Link>,
  React.ComponentPropsWithoutRef<typeof P.Link>
>(({ className, ...props }, ref) => (
  <P.Link
    ref={ref}
    data-slot="navigation-menu-link"
    className={cn("onyx-navigation-link", className)}
    {...props}
  />
));
NavigationMenuLink.displayName = "NavigationMenuLink";
export const NavigationMenuIndicator = React.forwardRef<
  React.ElementRef<typeof P.Indicator>,
  React.ComponentPropsWithoutRef<typeof P.Indicator>
>(({ className, ...props }, ref) => (
  <P.Indicator
    ref={ref}
    data-slot="navigation-menu-indicator"
    className={cn("onyx-navigation-indicator", className)}
    {...props}
  />
));
NavigationMenuIndicator.displayName = "NavigationMenuIndicator";
export const NavigationMenuViewport = React.forwardRef<
  React.ElementRef<typeof P.Viewport>,
  React.ComponentPropsWithoutRef<typeof P.Viewport>
>(({ className, ...props }, ref) => (
  <P.Viewport
    ref={ref}
    data-slot="navigation-menu-viewport"
    className={cn("onyx-navigation-viewport", className)}
    {...props}
  />
));
NavigationMenuViewport.displayName = "NavigationMenuViewport";
