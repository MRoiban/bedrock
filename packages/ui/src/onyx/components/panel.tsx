/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "../lib/cn";

export const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "section";
  return (
    <Component
      ref={ref}
      data-slot="panel"
      className={cn(
        "flex min-h-0 flex-col rounded-[var(--onyx-radius-lg)] border border-[var(--onyx-border-default)] bg-[var(--onyx-surface-panel)] text-[var(--onyx-text-foreground)] shadow-[var(--onyx-shadow-sm)]",
        className,
      )}
      {...props}
    />
  );
});
Panel.displayName = "Panel";

export const PanelHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "header";
  return (
    <Component
      ref={ref}
      data-slot="panel-header"
      className={cn(
        "flex items-center gap-3 border-b border-[var(--onyx-border-default)] bg-[var(--onyx-shell-toolbar-bg)] px-4 py-3",
        className,
      )}
      {...props}
    />
  );
});
PanelHeader.displayName = "PanelHeader";

export const PanelBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "div";
  return (
    <Component
      ref={ref}
      data-slot="panel-body"
      className={cn("min-h-0 flex-1 px-4 py-3", className)}
      {...props}
    />
  );
});
PanelBody.displayName = "PanelBody";

export const PanelFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "footer";
  return (
    <Component
      ref={ref}
      data-slot="panel-footer"
      className={cn(
        "flex items-center gap-3 border-t border-[var(--onyx-border-default)] px-4 py-3",
        className,
      )}
      {...props}
    />
  );
});
PanelFooter.displayName = "PanelFooter";

export const listRowVariants = cva("onyx-list-row");
export const treeRowVariants = cva("onyx-tree-row");
export interface ListRowProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  selected?: boolean;
  focused?: boolean;
  disabled?: boolean;
}
export const ListRow = React.forwardRef<HTMLDivElement, ListRowProps>(
  ({ className, asChild, selected, focused, disabled, ...props }, ref) => {
    const Component = asChild ? Slot : "div";
    return (
      <Component
        ref={ref}
        data-slot="list-row"
        data-selected={selected === undefined ? undefined : String(selected)}
        data-focused={focused === undefined ? undefined : String(focused)}
        data-disabled={disabled ? "" : undefined}
        className={cn(listRowVariants(), className)}
        {...props}
      />
    );
  },
);
ListRow.displayName = "ListRow";
export const TreeRow = React.forwardRef<HTMLDivElement, ListRowProps>(
  ({ className, ...props }, ref) => (
    <ListRow
      ref={ref}
      data-slot="tree-row"
      className={cn(treeRowVariants(), className)}
      {...props}
    />
  ),
);
TreeRow.displayName = "TreeRow";
