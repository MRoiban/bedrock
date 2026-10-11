/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { useComposedRefs } from "../lib/compose-refs";

import { Button } from "./button";
import { cn } from "../lib/cn";

interface TabsContextValue {
  value: string | null;
  variant: "editor" | "line";
  id: string;
  setValue: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs parts must be used within <Tabs>.");
  }
  return context;
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "editor" | "line";
  asChild?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export const tabTriggerVariants = cva(
  "inline-flex min-h-9 items-center gap-2 rounded-t-[var(--onyx-radius-md)] border border-b-0 border-transparent px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onyx-control-focus-ring)]",
  {
    variants: {
      active: {
        true: "border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-surface-panel)] text-[var(--onyx-text-foreground)]",
        false:
          "text-[var(--onyx-text-description)] hover:bg-[var(--onyx-state-hover)] hover:text-[var(--onyx-text-foreground)]",
      },
    },
    defaultVariants: {
      active: false,
    },
  },
);

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  (
    {
      children,
      className,
      defaultValue,
      onValueChange,
      value: valueProp,
      variant = "editor",
      asChild,
      ...props
    },
    ref,
  ) => {
    const id = React.useId();
    const Component = asChild ? Slot : "div";
    const [uncontrolledValue, setUncontrolledValue] = React.useState<
      string | null
    >(defaultValue ?? null);
    const value = valueProp ?? uncontrolledValue;

    const setValue = React.useCallback(
      (nextValue: string) => {
        if (valueProp === undefined) {
          setUncontrolledValue(nextValue);
        }
        onValueChange?.(nextValue);
      },
      [onValueChange, valueProp],
    );

    return (
      <TabsContext.Provider value={{ value, setValue, variant, id }}>
        <Component
          ref={ref}
          data-slot="tabs"
          data-variant={variant}
          className={cn(
            tabsVariants({ variant }),
            "flex min-h-0 flex-col",
            className,
          )}
          {...props}
        >
          {children}
        </Component>
      </TabsContext.Provider>
    );
  },
);
Tabs.displayName = "Tabs";

export const tabsVariants = cva("onyx-tabs", {
  variants: { variant: { editor: "", line: "" } },
  defaultVariants: { variant: "editor" },
});
export const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(
  (
    { className, asChild, onKeyDown, onFocusCapture, onBlurCapture, ...props },
    forwardedRef,
  ) => {
    const context = useTabsContext();
    const listRef = React.useRef<HTMLDivElement>(null);
    const ref = useComposedRefs(forwardedRef, listRef);
    const getItems = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>("[role=tab]") ?? [])
      .filter((el) => !el.matches('[aria-disabled="true"], :disabled') && !el.closest('[hidden], [inert]'));
    const sync = (target?: HTMLElement) => {
      const all = getItems();
      const focused = all.find((el) => el === document.activeElement || el.contains(document.activeElement));
      const active = target ?? focused ?? all.find((el) => el.getAttribute("aria-selected") === "true") ?? all[0];
      listRef.current?.querySelectorAll<HTMLElement>("[role=tab]").forEach((el) => { el.tabIndex = el === active ? 0 : -1; });
    };
    React.useLayoutEffect(() => { sync(); });
    React.useEffect(() => {
      const observer = new MutationObserver(() => sync());
      if (listRef.current) observer.observe(listRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "aria-disabled", "hidden", "inert"] });
      return () => observer.disconnect();
    }, []);
    const Component = asChild ? Slot : "div";
    return (
      <Component
        ref={ref}
        data-slot="tabs-list"
        data-variant={context.variant}
        role="tablist"
        className={cn(
          context.variant === "editor" &&
            "flex items-end gap-1 border-b border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-shell-tabs-bg)] px-2 pt-2",
          context.variant === "line" && "onyx-tabs-line-list",
          className,
        )}
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          const all = getItems();
          const index = all.findIndex((el) => el === event.target);
          if (index < 0) return;
          let next = index;
          if (event.key === "ArrowRight") next++;
          else if (event.key === "ArrowLeft") next--;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = all.length - 1;
          else return;
          event.preventDefault();
          const target = all[(next + all.length) % all.length];
          sync(target);
          target?.focus();
        }}
        onFocusCapture={(event: React.FocusEvent<HTMLDivElement>) => {
          onFocusCapture?.(event);
          if (!event.defaultPrevented) sync(getItems().find((el) => el === event.target || el.contains(event.target as Node)));
        }}
        onBlurCapture={(event: React.FocusEvent<HTMLDivElement>) => {
          onBlurCapture?.(event);
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            sync(getItems().find((el) => el.getAttribute("aria-selected") === "true") ?? getItems()[0]);
          }
        }}
        {...props}
      />
    );
  },
);
TabsList.displayName = "TabsList";

export interface TabsTriggerProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "value">,
    VariantProps<typeof tabTriggerVariants> {
  value: string;
  disabled?: boolean;
  asChild?: boolean;
}

export const TabsTrigger = React.forwardRef<HTMLDivElement, TabsTriggerProps>(
  (
    {
      className,
      children,
      disabled = false,
      asChild,
      onClick,
      onKeyDown,
      value,
      ...props
    },
    ref,
  ) => {
    const context = useTabsContext();
    const active = context.value === value;
    const Component = asChild ? Slot : "div";

    const selectTab = React.useCallback(() => {
      if (!disabled) {
        context.setValue(value);
      }
    }, [context, disabled, value]);

    return (
      <Component
        ref={ref}
        data-slot="tabs-trigger"
        data-variant={context.variant}
        id={`${context.id}-tab-${encodeURIComponent(value)}`}
        aria-controls={`${context.id}-panel-${encodeURIComponent(value)}`}
        data-state={active ? "active" : "inactive"}
        role="tab"
        aria-selected={active}
        aria-disabled={disabled || undefined}
        className={cn(
          context.variant === "editor"
            ? tabTriggerVariants({ active })
            : "onyx-tabs-line-trigger",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
        onClick={(event: React.MouseEvent<HTMLDivElement>) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            selectTab();
          }
        }}
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectTab();
          }
        }}
        {...props}
      >
        {children}
      </Component>
    );
  },
);
TabsTrigger.displayName = "TabsTrigger";

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  asChild?: boolean;
}

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, hidden, asChild, ...props }, ref) => {
    const context = useTabsContext();
    const active = context.value === value;
    const Component = asChild ? Slot : "div";

    return (
      <Component
        ref={ref}
        data-slot="tabs-content"
        id={`${context.id}-panel-${encodeURIComponent(value)}`}
        aria-labelledby={`${context.id}-tab-${encodeURIComponent(value)}`}
        tabIndex={0}
        data-state={active ? "active" : "inactive"}
        role="tabpanel"
        hidden={hidden ?? !active}
        className={cn("min-h-0 flex-1", className)}
        {...props}
      />
    );
  },
);
TabsContent.displayName = "TabsContent";

export const TabClose = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, onClick, type = "button", ...props }, ref) => (
  <Button
    ref={ref}
    data-slot="tab-close"
    variant="ghost"
    size="icon"
    type={type}
    className={cn(
      "h-6 w-6 text-[var(--onyx-text-description)] hover:text-[var(--onyx-text-foreground)]",
      className,
    )}
    onClick={(event) => {
      event.stopPropagation();
      onClick?.(event);
    }}
    {...props}
  />
));
TabClose.displayName = "TabClose";

export const TabBadge = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    data-slot="tab-badge"
    className={cn(
      "inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--onyx-shell-badge-bg)] px-1.5 text-[length:var(--onyx-text-xs)] font-semibold text-[var(--onyx-shell-badge-fg)]",
      className,
    )}
    {...props}
  />
));
TabBadge.displayName = "TabBadge";

export const TabList = TabsList;
export const Tab = TabsTrigger;
