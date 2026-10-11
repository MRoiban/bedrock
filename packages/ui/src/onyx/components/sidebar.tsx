/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { Button } from "./button";
import { Icon } from "./icon";
import { ResizeHandle } from "./resize-handle";
import { cn } from "../lib/cn";
import {
  browserSidebarEnvironment,
  createSidebarEnvironment,
  type SidebarEnvironment,
  type SidebarResolvedEnvironment,
} from "./sidebar-environment";

export type SidebarVariant = "sidebar" | "floating" | "inset";
export type SidebarSide = "left" | "right";
export type SidebarCollapsible = "offcanvas" | "icon" | "none";
export { createSidebarEnvironment };
export type {
  SidebarEnvironment,
  SidebarResolvedEnvironment,
} from "./sidebar-environment";

export interface SidebarContextValue {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
  side: SidebarSide;
  variant: SidebarVariant;
  collapsible: SidebarCollapsible;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebarContext(): SidebarContextValue {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }
  return context;
}

export interface SidebarProviderProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  defaultOpenMobile?: boolean | undefined;
  openMobile?: boolean | undefined;
  onOpenMobileChange?: ((open: boolean) => void) | undefined;
  side?: SidebarSide | undefined;
  variant?: SidebarVariant | undefined;
  collapsible?: SidebarCollapsible | undefined;
  environment?: SidebarEnvironment | undefined;
}

export function SidebarProvider({
  children,
  className,
  collapsible = "offcanvas",
  defaultOpen = true,
  defaultOpenMobile = false,
  onOpenChange,
  onOpenMobileChange,
  open: openProp,
  openMobile: openMobileProp,
  side = "left",
  variant = "sidebar",
  environment,
  ...props
}: SidebarProviderProps): React.ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const [uncontrolledOpenMobile, setUncontrolledOpenMobile] =
    React.useState(defaultOpenMobile);

  const open = openProp ?? uncontrolledOpen;
  const openMobile = openMobileProp ?? uncontrolledOpenMobile;
  const sidebarEnvironment = React.useMemo(
    () =>
      environment
        ? createSidebarEnvironment(environment)
        : browserSidebarEnvironment,
    [environment],
  );
  const isMobile = sidebarEnvironment.isMobile();

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (onOpenChange) {
        onOpenChange(nextOpen);
        return;
      }
      setUncontrolledOpen(nextOpen);
    },
    [onOpenChange],
  );

  const setOpenMobile = React.useCallback(
    (nextOpen: boolean) => {
      if (onOpenMobileChange) {
        onOpenMobileChange(nextOpen);
        return;
      }
      setUncontrolledOpenMobile(nextOpen);
    },
    [onOpenMobileChange],
  );

  const toggleSidebar = React.useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);

  const contextValue = React.useMemo<SidebarContextValue>(
    () => ({
      collapsible,
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      side,
      state: open ? "expanded" : "collapsed",
      toggleSidebar,
      variant,
    }),
    [
      collapsible,
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      side,
      toggleSidebar,
      variant,
    ],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-provider"
        className={cn(
          "relative flex h-full w-full text-[var(--onyx-text-foreground)]",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: SidebarSide;
  variant?: SidebarVariant;
  collapsible?: SidebarCollapsible;
}

export const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ className, collapsible, side, variant, ...props }, ref) => {
    const context = useSidebarContext();
    const resolvedSide = side ?? context.side;
    const resolvedVariant = variant ?? context.variant;
    const resolvedCollapsible = collapsible ?? context.collapsible;

    return (
      <aside
        ref={ref}
        data-slot="sidebar"
        data-collapsible={resolvedCollapsible}
        data-side={resolvedSide}
        data-state={context.state}
        data-variant={resolvedVariant}
        className={cn(
          "flex h-full w-full flex-col bg-[var(--onyx-surface-sidebar)] text-[var(--onyx-text-foreground)] border-r border-[var(--onyx-border-default)] transition-[width] duration-200",
          resolvedVariant === "floating" &&
            "border border-[var(--onyx-border-default)] shadow-[var(--onyx-shadow-md)]",
          resolvedCollapsible === "icon" &&
            context.state === "collapsed" &&
            "w-14",
          className,
        )}
        {...props}
      />
    );
  },
);
Sidebar.displayName = "Sidebar";

export const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-content"
    className={cn("flex-1 overflow-y-auto overflow-x-hidden py-2", className)}
    {...props}
  />
));
SidebarContent.displayName = "SidebarContent";

export const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-header"
    className={cn(
      "sticky top-0 z-10 flex flex-col gap-2 border-b border-[var(--onyx-border-default)] bg-[var(--onyx-shell-toolbar-bg)] p-3",
      className,
    )}
    {...props}
  />
));
SidebarHeader.displayName = "SidebarHeader";

/**
 * Title row of a sidebar view (VS Code's view title bar): a label on the left
 * and a toolbar of view actions on the right. Height comes from
 * `--onyx-sidebar-view-header-height` so hosts can align it with their tab row.
 */
export const SidebarViewHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-view-header"
    className={cn(
      "flex h-[var(--onyx-sidebar-view-header-height,35px)] min-h-[var(--onyx-sidebar-view-header-height,35px)] shrink-0 items-center justify-between gap-2 border-b border-[var(--onyx-border-default)] pl-3 pr-1.5",
      className,
    )}
    {...props}
  />
));
SidebarViewHeader.displayName = "SidebarViewHeader";

export const SidebarViewTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    data-slot="sidebar-view-title"
    className={cn(
      "min-w-0 truncate text-xs font-semibold text-[var(--onyx-text-description)]",
      className,
    )}
    {...props}
  />
));
SidebarViewTitle.displayName = "SidebarViewTitle";

export const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-footer"
    className={cn(
      "sticky bottom-0 z-10 border-t border-[var(--onyx-border-default)] bg-[var(--onyx-shell-toolbar-bg)] p-3",
      className,
    )}
    {...props}
  />
));
SidebarFooter.displayName = "SidebarFooter";

export const SidebarGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-group"
    className={cn("flex flex-col gap-2 px-2", className)}
    {...props}
  />
));
SidebarGroup.displayName = "SidebarGroup";

export const SidebarGroupLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-group-label"
    className={cn(
      "text-xs font-semibold text-[var(--onyx-text-description)]",
      className,
    )}
    {...props}
  />
));
SidebarGroupLabel.displayName = "SidebarGroupLabel";

export const SidebarGroupContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-group-content"
    className={cn("flex flex-col gap-1", className)}
    {...props}
  />
));
SidebarGroupContent.displayName = "SidebarGroupContent";

export const SidebarGroupAction = React.forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentPropsWithoutRef<typeof Button>
>(({ className, size, type = "button", variant, ...props }, ref) => (
  <Button
    ref={ref}
    data-slot="sidebar-group-action"
    size={size ?? "icon"}
    type={type}
    variant={variant ?? "ghost"}
    className={cn(
      "h-6 w-6 border border-transparent text-[var(--onyx-text-muted)] hover:border-[var(--onyx-control-focus-ring)] hover:text-[var(--onyx-text-foreground)] focus-visible:ring-[var(--onyx-control-focus-ring)]",
      className,
    )}
    {...props}
  />
));
SidebarGroupAction.displayName = "SidebarGroupAction";

export const SidebarMenu = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-menu"
    className={cn(
      "flex flex-col gap-1 text-sm text-[var(--onyx-text-foreground)]",
      className,
    )}
    {...props}
  />
));
SidebarMenu.displayName = "SidebarMenu";

export const SidebarMenuItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-menu-item"
    className={cn("group/menu-item relative", className)}
    {...props}
  />
));
SidebarMenuItem.displayName = "SidebarMenuItem";

export interface SidebarMenuButtonProps extends React.ComponentPropsWithoutRef<
  typeof Button
> {
  asChild?: boolean;
  isActive?: boolean;
}

export const SidebarMenuButton = React.forwardRef<
  React.ElementRef<typeof Button>,
  SidebarMenuButtonProps
>(
  (
    {
      asChild = false,
      className,
      children,
      isActive,
      size,
      type,
      variant,
      ...props
    },
    ref,
  ) => (
    <Button
      ref={ref}
      asChild={asChild}
      data-slot="sidebar-menu-button"
      size={size ?? "sm"}
      type={asChild ? type : (type ?? "button")}
      variant={variant ?? "ghost"}
      className={cn(
        "w-full justify-start gap-2 rounded-[var(--onyx-radius-md)] px-2 py-1.5 text-left font-normal text-[var(--onyx-text-foreground)] hover:bg-[var(--onyx-state-hover)] hover:text-[var(--onyx-text-foreground)] focus-visible:ring-[var(--onyx-control-focus-ring)]",
        isActive &&
          "bg-[var(--onyx-state-selected)] text-[var(--onyx-state-selected-fg)] shadow-[var(--onyx-shadow-sm)] hover:bg-[var(--onyx-state-selected)]",
        className,
      )}
      data-active={isActive ? "true" : "false"}
      {...props}
    >
      {children}
    </Button>
  ),
);
SidebarMenuButton.displayName = "SidebarMenuButton";

export const SidebarMenuAction = React.forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentPropsWithoutRef<typeof Button>
>(({ className, size, type = "button", variant, ...props }, ref) => (
  <Button
    ref={ref}
    data-slot="sidebar-menu-action"
    size={size ?? "icon"}
    type={type}
    variant={variant ?? "ghost"}
    className={cn(
      "absolute right-2 top-1/2 -translate-y-1/2 scale-0 border border-transparent p-1 text-[var(--onyx-text-description)] opacity-0 transition-all duration-150 group-hover/menu-item:scale-100 group-hover/menu-item:opacity-100 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:ring-[var(--onyx-control-focus-ring)] active:scale-95",
      className,
    )}
    {...props}
  />
));
SidebarMenuAction.displayName = "SidebarMenuAction";

export const SidebarMenuBadge = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="sidebar-menu-badge"
    className={cn(
      "ml-auto inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-[var(--onyx-shell-badge-bg)] px-1.5 text-xs font-medium text-[var(--onyx-shell-badge-fg)]",
      className,
    )}
    {...props}
  />
));
SidebarMenuBadge.displayName = "SidebarMenuBadge";

export const SidebarSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-separator"
    className={cn("my-2 h-px bg-[var(--onyx-border-default)]", className)}
    {...props}
  />
));
SidebarSeparator.displayName = "SidebarSeparator";

export interface SidebarRailProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean | undefined;
  width?: number | undefined;
  defaultWidth?: number | undefined;
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
  onWidthChange?: ((width: number) => void) | undefined;
  disabled?: boolean | undefined;
}
const ProviderSidebarRail = React.forwardRef<HTMLDivElement, SidebarRailProps>(
  (
    {
      className,
      defaultValue: _defaultValue,
      width: controlledWidth,
      defaultWidth = 240,
      minWidth = 160,
      maxWidth = 800,
      onWidthChange,
      disabled,
      ...props
    },
    forwardedRef,
  ) => {
    const context = useSidebarContext();
    const localRef = React.useRef<HTMLDivElement | null>(null);
    const [width, setWidth] = React.useState(defaultWidth);
    const [collapsedWidth, setCollapsedWidth] = React.useState(0);
    const expandedWidth = React.useRef(controlledWidth ?? defaultWidth);
    if (context.open && (controlledWidth ?? width) > collapsedWidth)
      expandedWidth.current = controlledWidth ?? width;
    const previousOpen = React.useRef(context.open);
    React.useEffect(() => {
      const sidebar = localRef.current?.closest<HTMLElement>(
        "[data-slot=sidebar]",
      );
      if (!sidebar) return;
      if (!context.open && !onWidthChange && controlledWidth === undefined) {
        sidebar.style.width = context.collapsible === "icon" ? "" : "0px";
      } else if (context.open && !previousOpen.current) {
        if (
          onWidthChange &&
          controlledWidth !== undefined &&
          controlledWidth <= collapsedWidth
        )
          onWidthChange(expandedWidth.current);
        else if (!onWidthChange && controlledWidth === undefined)
          sidebar.style.width = `${expandedWidth.current}px`;
      }
      previousOpen.current = context.open;
    }, [
      context.open,
      context.collapsible,
      controlledWidth,
      onWidthChange,
      collapsedWidth,
    ]);
    React.useEffect(() => {
      if (controlledWidth !== undefined) return;
      const sidebar = localRef.current?.closest<HTMLElement>(
        "[data-slot=sidebar]",
      );
      if (!sidebar) return;
      const observer = new ResizeObserver((entries) => {
        const measured =
          entries[0]?.borderBoxSize?.[0]?.inlineSize ?? sidebar.offsetWidth;
        if (context.open && measured > 0) setWidth(measured);
        else if (!context.open) setCollapsedWidth(measured);
      });
      observer.observe(sidebar);
      return () => observer.disconnect();
    }, [controlledWidth, context.open]);
    const update = (value: number) => {
      if (controlledWidth !== undefined && !onWidthChange) return;
      const expanded = value > collapsedWidth;
      if (expanded) {
        setWidth(value);
        expandedWidth.current = value;
      }
      if (onWidthChange) onWidthChange(value);
      else {
        const sidebar = localRef.current?.closest<HTMLElement>(
          "[data-slot=sidebar]",
        );
        if (sidebar && expanded) {
          sidebar.style.width = `${value}px`;
          sidebar.style.flexShrink = "0";
        }
      }
      if (context.collapsible !== "none") context.setOpen(expanded);
    };
    return (
      <ResizeHandle
        ref={(node) => {
          localRef.current = node;
          if (typeof forwardedRef === "function") return forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        data-slot="sidebar-rail"
        aria-label="Resize sidebar"
        orientation="vertical"
        value={context.open ? (controlledWidth ?? width) : collapsedWidth}
        defaultValue={defaultWidth}
        min={minWidth}
        max={maxWidth}
        collapsible={context.collapsible !== "none"}
        collapsedSize={collapsedWidth}
        disabled={disabled}
        direction={context.side === "right" ? -1 : 1}
        onValueChange={update}
        className={cn(
          "absolute inset-y-0",
          context.side === "right" ? "left-0" : "right-0",
          className,
        )}
        {...props}
      />
    );
  },
);
export const SidebarRail = React.forwardRef<HTMLDivElement, SidebarRailProps>(
  ({ className, asChild, width, defaultWidth, minWidth, maxWidth, onWidthChange, disabled, ...props }, ref) => {
    const context = React.useContext(SidebarContext);
    if (context) return <ProviderSidebarRail ref={ref} className={className} asChild={asChild} width={width} defaultWidth={defaultWidth} minWidth={minWidth} maxWidth={maxWidth} onWidthChange={onWidthChange} disabled={disabled} {...props} />;
    const Comp = asChild ? Slot : 'div';
    return <Comp ref={ref} data-slot="sidebar-rail" className={cn('absolute inset-y-0 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--onyx-control-focus-ring)]', className)} {...props} />;
  },
);
SidebarRail.displayName = "SidebarRail";

export interface SidebarMenuSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  showIcon?: boolean;
}

export const SidebarMenuSkeleton = React.forwardRef<
  HTMLDivElement,
  SidebarMenuSkeletonProps
>(({ className, showIcon = false, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-menu-skeleton"
    className={cn("flex items-center gap-2 px-2 py-1.5", className)}
    {...props}
  >
    {showIcon ? (
      <span
        className="h-4 w-4 rounded bg-[var(--onyx-border-default)]"
        aria-hidden="true"
      />
    ) : null}
    <span
      className="h-3 flex-1 rounded bg-[var(--onyx-border-default)]"
      aria-hidden="true"
    />
  </div>
));
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

export const ActivityBar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : 'div';
  return <Component
    ref={ref}
    data-slot="activity-bar"
    role="none"
    className={cn(
      "flex h-full w-12 shrink-0 flex-col items-center border-r border-[var(--onyx-border-default)] bg-[var(--onyx-shell-activity-bar-bg)]",
      className,
    )}
    {...props}
/>;
});
ActivityBar.displayName = "ActivityBar";

export interface ActivityBarItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean | undefined;
  label?: string | undefined;
  badge?: number | undefined;
}

export const ActivityBarItem = React.forwardRef<
  HTMLButtonElement,
  ActivityBarItemProps
>(({ badge, children, className, isActive, label, ...props }, ref) => (
  <button
    ref={ref}
    data-slot="activity-bar-item"
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={isActive}
    className={cn(
      "relative flex h-12 w-12 shrink-0 cursor-pointer select-none items-center justify-center bg-transparent text-[length:var(--activity-bar-icon-size,24px)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--onyx-control-focus-ring)]",
      isActive
        ? "text-[var(--onyx-shell-activity-bar-fg)]"
        : "text-[var(--onyx-shell-activity-bar-inactive-fg)] hover:text-[var(--onyx-shell-activity-bar-fg)]",
      isActive && [
        "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-6 before:w-[2px] before:rounded-r-sm before:bg-[var(--onyx-control-focus-ring)] before:content-['']",
      ],
      "hover:bg-[color-mix(in_srgb,var(--onyx-state-hover)_65%,transparent)]",
      className,
    )}
    {...props}
  >
    {children}
    {badge !== undefined && badge > 0 ? (
      <span
        className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--onyx-shell-badge-bg)] px-1 text-[10px] font-medium tabular-nums text-[var(--onyx-shell-badge-fg)]"
        aria-label={`${badge} notifications`}
      >
        {badge > 99 ? "99+" : badge}
      </span>
    ) : null}
  </button>
));
ActivityBarItem.displayName = "ActivityBarItem";

export const ActivityBarSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="activity-bar-separator"
    role="separator"
    className={cn(
      "mx-3 my-1 h-px bg-[var(--onyx-border-default)] opacity-40",
      className,
    )}
    {...props}
  />
));
ActivityBarSeparator.displayName = "ActivityBarSeparator";

export const ActivityBarSpacer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="activity-bar-spacer"
    className={cn("flex-1", className)}
    {...props}
  />
));
ActivityBarSpacer.displayName = "ActivityBarSpacer";

export interface ActivityBarItemDef {
  id: string;
  icon: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
}

export interface WorkbenchSidebarProps {
  activityBarVisible: boolean;
  onActivityBarVisibleChange: (visible: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityItems: ActivityBarItemDef[];
  bottomActivityItems?: ActivityBarItemDef[];
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  sidebarWidth?: number;
  onSidebarWidthChange?: (width: number) => void;
  sidebarMinWidth?: number;
  sidebarMaxWidth?: number;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  environment?: SidebarEnvironment;
}

export function WorkbenchSidebar({
  activityBarVisible,
  onActivityBarVisibleChange: _onActivityBarVisibleChange,
  open,
  onOpenChange: _onOpenChange,
  activityItems,
  bottomActivityItems,
  header,
  footer,
  children,
  sidebarWidth = 320,
  onSidebarWidthChange,
  sidebarMinWidth = 200,
  sidebarMaxWidth = 2000,
  className,
  contentClassName,
  environment,
  footerClassName,
  headerClassName,
}: WorkbenchSidebarProps): React.ReactElement | null {
  const sidebarRef = React.useRef<HTMLDivElement | null>(null);
  if (!activityBarVisible && !open) {
    return null;
  }

  return (
    <div data-slot="workbench-sidebar" className="flex h-full shrink-0">
      {activityBarVisible ? (
        <ActivityBar>
          {activityItems.map((item) => (
            <ActivityBarItem
              key={item.id}
              badge={item.badge}
              isActive={item.isActive}
              label={item.label}
              onClick={item.onClick}
            >
              <Icon name={item.icon} size="lg" />
            </ActivityBarItem>
          ))}

          <ActivityBarSpacer />

          {bottomActivityItems?.map((item) => (
            <ActivityBarItem
              key={item.id}
              badge={item.badge}
              isActive={item.isActive}
              label={item.label}
              onClick={item.onClick}
            >
              <Icon name={item.icon} size="lg" />
            </ActivityBarItem>
          ))}
        </ActivityBar>
      ) : null}

      {open ? (
        <SidebarProvider
          className="h-full"
          collapsible="none"
          environment={environment}
          onOpenChange={() => {}}
          open={true}
          side="left"
          variant="sidebar"
        >
          <Sidebar
            ref={sidebarRef}
            className={cn(
              "relative h-full border-r border-[var(--onyx-border-default)] bg-[var(--onyx-surface-sidebar)]",
              className,
            )}
            style={{ width: sidebarWidth }}
          >
            {header ? (
              <SidebarHeader className={headerClassName}>
                {header}
              </SidebarHeader>
            ) : null}
            <SidebarContent className={contentClassName}>
              {children}
            </SidebarContent>
            {footer ? (
              <SidebarFooter className={footerClassName}>
                {footer}
              </SidebarFooter>
            ) : null}
            <SidebarRail
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              className="right-0 translate-x-1/2 touch-none"
              role="separator"
              width={sidebarWidth}
              defaultWidth={sidebarWidth}
              minWidth={sidebarMinWidth}
              maxWidth={sidebarMaxWidth}
              onWidthChange={onSidebarWidthChange}
              disabled={!onSidebarWidthChange}
            />
          </Sidebar>
        </SidebarProvider>
      ) : null}
    </div>
  );
}

export const useSidebar = useSidebarContext;
