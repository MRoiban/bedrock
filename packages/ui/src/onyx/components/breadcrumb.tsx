/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "./menu";
export const breadcrumbVariants = cva("onyx-breadcrumb");
export const breadcrumbListVariants = cva("onyx-breadcrumb-list");
export const breadcrumbItemVariants = cva("onyx-breadcrumb-item");
export const breadcrumbLinkVariants = cva("onyx-breadcrumb-link");
export const breadcrumbSeparatorVariants = cva("onyx-breadcrumb-separator");
export const breadcrumbOverflowVariants = cva("onyx-breadcrumb-overflow");
export interface BreadcrumbEntry {
  label: React.ReactNode;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
}
export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
  items?: BreadcrumbEntry[];
  maxItems?: number;
  onOverflowClick?: (items: BreadcrumbEntry[]) => void;
}
export function useBreadcrumb(
  items: BreadcrumbEntry[] = [],
  maxItems = Infinity,
) {
  const max = Math.max(3, Math.floor(maxItems));
  const hidden =
    items.length > max ? items.slice(1, items.length - max + 2) : [];
  const visible = hidden.length
    ? [items[0]!, ...items.slice(items.length - max + 2)]
    : items;
  return { hidden, visible };
}
export const Breadcrumb = React.forwardRef<HTMLElement, BreadcrumbProps>(
  (
    {
      asChild,
      items,
      maxItems,
      onOverflowClick,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "nav";
    const { visible, hidden } = useBreadcrumb(items, maxItems);
    return (
      <Comp
        ref={ref}
        aria-label="Breadcrumb"
        data-slot="breadcrumb"
        className={cn(breadcrumbVariants(), className)}
        {...props}
      >
        {asChild || !items ? (
          children
        ) : (
          <BreadcrumbList>
            {visible.map((item, index) => (
              <React.Fragment key={index}>
                {index > 0 && hidden.length > 0 && index === 1 && (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbOverflow
                        items={hidden}
                        onOverflowClick={onOverflowClick}
                      />
                    </BreadcrumbItem>
                  </>
                )}
                <BreadcrumbItem>
                  {index > 0 && <BreadcrumbSeparator />}
                  {index === visible.length - 1 ? (
                    <BreadcrumbLink
                      href={item.href}
                      onClick={item.onClick}
                      aria-current="page"
                    >
                      {item.label}
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbLink href={item.href} onClick={item.onClick}>
                      {item.label}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        )}
      </Comp>
    );
  },
);
Breadcrumb.displayName = "Breadcrumb";
export const BreadcrumbList = React.forwardRef<
  HTMLOListElement,
  React.OlHTMLAttributes<HTMLOListElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "ol";
  return (
    <Comp
      ref={ref}
      data-slot="breadcrumb-list"
      className={cn(breadcrumbListVariants(), className)}
      {...props}
    />
  );
});
export const BreadcrumbItem = React.forwardRef<
  HTMLLIElement,
  React.LiHTMLAttributes<HTMLLIElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "li";
  return (
    <Comp
      ref={ref}
      data-slot="breadcrumb-item"
      className={cn(breadcrumbItemVariants(), className)}
      {...props}
    />
  );
});
export const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      ref={ref}
      data-slot="breadcrumb-link"
      className={cn(breadcrumbLinkVariants(), className)}
      {...props}
    />
  );
});
export const BreadcrumbSeparator = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean | undefined }
>(({ asChild, className, children, ...props }, ref) => {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      ref={ref}
      data-slot="breadcrumb-separator"
      aria-hidden="true"
      className={cn(breadcrumbSeparatorVariants(), className)}
      {...props}
    >
      {children ?? <Icon name="chevron-right" size="sm" />}
    </Comp>
  );
});
export const BreadcrumbOverflow = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    items: BreadcrumbEntry[];
    onOverflowClick?: ((items: BreadcrumbEntry[]) => void) | undefined;
  }
>(({ items, onOverflowClick, className, ...props }, ref) => (
  <>
    <BreadcrumbSeparator />
    <Menu>
      <MenuTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label="Show hidden breadcrumbs"
          data-slot="breadcrumb-overflow"
          className={cn(breadcrumbOverflowVariants(), className)}
          {...props}
          onClick={(e) => {
            props.onClick?.(e);
            if (!e.defaultPrevented) onOverflowClick?.(items);
          }}
        >
          <Icon name="ellipsis" />
        </button>
      </MenuTrigger>
      <MenuContent>
        {items.map((item, i) => (
          <MenuItem key={i} asChild={!!item.href} {...(item.onClick ? { onSelect: item.onClick } : {})}>
            {item.href ? <a href={item.href}>{item.label}</a> : item.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  </>
));
BreadcrumbList.displayName = "BreadcrumbList";
BreadcrumbItem.displayName = "BreadcrumbItem";
BreadcrumbLink.displayName = "BreadcrumbLink";
BreadcrumbSeparator.displayName = "BreadcrumbSeparator";
BreadcrumbOverflow.displayName = "BreadcrumbOverflow";
