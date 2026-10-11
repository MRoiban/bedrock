/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
export const linkVariants = cva("onyx-link", {
  variants: { variant: { default: "onyx-link--variant-default", muted: "onyx-link--variant-muted" } },
  defaultVariants: { variant: "default" },
});
export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  asChild?: boolean;
  external?: boolean;
  externalIcon?: boolean;
  variant?: "default" | "muted";
}
export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  (
    {
      asChild,
      external = false,
      externalIcon = true,
      variant = "default",
      target,
      rel,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "a";
    return (
      <Comp
        ref={ref}
        data-slot="link"
        data-variant={variant}
        data-external={external || undefined}
        className={cn(linkVariants({ variant }), className)}
        target={target ?? (external ? "_blank" : undefined)}
        rel={
          rel ??
          (external || target === "_blank" ? "noopener noreferrer" : undefined)
        }
        {...props}
      >
        <Slottable>{children}</Slottable>
        {external && externalIcon && (
          <Icon data-slot="link-external-icon" name="link-external" size="sm" />
        )}
      </Comp>
    );
  },
);
Link.displayName = "Link";
