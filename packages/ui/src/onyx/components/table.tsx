/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { Icon } from "./icon";

import { cn } from "../lib/cn";

export const tableVariants = cva("onyx-table");
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "table";
  return (
    <Component
      ref={ref}
      data-slot="table"
      className={cn(
        tableVariants(),
        "w-full border-collapse text-[length:var(--onyx-text-sm)]",
        className,
      )}
      {...props}
    />
  );
});
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "thead";
  return (
    <Component
      ref={ref}
      data-slot="table-header"
      className={cn("text-[length:var(--onyx-text-xs)] text-[var(--onyx-text-description)]", className)}
      {...props}
    />
  );
});
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "tbody";
  return (
    <Component
      ref={ref}
      data-slot="table-body"
      className={cn(
        "divide-y divide-[var(--onyx-border-default)] text-[length:var(--onyx-text-sm)]",
        className,
      )}
      {...props}
    />
  );
});
TableBody.displayName = "TableBody";

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
  asChild?: boolean;
}
const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, selected, asChild, ...props }, ref) => {
    const Component = asChild ? Slot : "tr";
    return (
      <Component
        ref={ref}
        data-slot="table-row"
        data-selected={selected === undefined ? undefined : String(selected)}
        data-state={selected ? "selected" : "idle"}
        aria-selected={selected}
        className={cn(
          "transition-colors hover:bg-[var(--onyx-state-hover)] data-[state=active]:bg-[var(--onyx-state-selected)] data-[selected=true]:bg-[var(--onyx-state-selected)] data-[selected=true]:text-[var(--onyx-state-selected-fg)]",
          className,
        )}
        {...props}
      />
    );
  },
);
TableRow.displayName = "TableRow";

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  asChild?: boolean;
  sort?: "ascending" | "descending" | "none";
  onSort?: () => void;
  sortButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
}
const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  (
    { className, sort, onSort, sortButtonProps, children, asChild, ...props },
    ref,
  ) => {
    const Component = asChild ? Slot : "th";
    const child =
      asChild && React.isValidElement<{ children?: React.ReactNode | undefined }>(children)
        ? children
        : null;
    const label = child ? child.props.children : children;
    const content =
      sort === undefined ? (
        label
      ) : (
        <button
          type="button"
          data-slot="table-sort-button"
          data-state={sort}
          onClick={onSort}
          {...sortButtonProps}
        >
          {label}
          <Icon
            data-slot="table-sort-icon"
            name={
              sort === "ascending"
                ? "arrow-up"
                : sort === "descending"
                  ? "arrow-down"
                  : "arrow-swap"
            }
          />
        </button>
      );
    return (
      <Component
        ref={ref}
        data-slot="table-head"
        aria-sort={sort}
        className={cn(
          "px-[var(--onyx-space-4)] py-[var(--onyx-space-3)] text-left font-[number:var(--onyx-weight-semibold)] text-[var(--onyx-text-description)]",
          className,
        )}
        {...props}
      >
        {child ? React.cloneElement(child, {}, content) : content}
      </Component>
    );
  },
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "td";
  return (
    <Component
      ref={ref}
      data-slot="table-cell"
      className={cn("px-[var(--onyx-space-4)] py-[var(--onyx-space-3)] align-top text-[length:var(--onyx-text-sm)]", className)}
      {...props}
    />
  );
});
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "caption";
  return (
    <Component
      ref={ref}
      data-slot="table-caption"
      className={cn(
        "px-[var(--onyx-space-4)] py-[var(--onyx-space-2)] text-left text-[length:var(--onyx-text-sm)] text-[var(--onyx-text-description)]",
        className,
      )}
      {...props}
    />
  );
});
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
};
