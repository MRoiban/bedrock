/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { usePortalContainer } from "./popover";
import * as React from "react";
import { cva } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import * as P from "@radix-ui/react-tooltip";
import { Kbd } from "./kbd";
export const tooltipVariants = cva("onyx-tooltip onyx-floating");
export const TooltipProvider = P.Provider;
export const TooltipRoot = P.Root;
export function TooltipPortal({ container, ...props }: React.ComponentPropsWithoutRef<typeof P.Portal>) {
  const host = usePortalContainer(container);
  return <P.Portal container={host} {...props} />;
}
export const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof P.Trigger>,
  React.ComponentPropsWithoutRef<typeof P.Trigger>
>(({ className, ...props }, ref) => (
  <P.Trigger
    ref={ref}
    data-slot="tooltip-trigger"
    className={cn("", className)}
    {...props}
  />
));
TooltipTrigger.displayName = "TooltipTrigger";
export interface TooltipContentProps extends React.ComponentPropsWithoutRef<
  typeof P.Content
> {
  shortcut?: React.ReactNode | undefined;
  container?: HTMLElement | null | undefined;
}
export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof P.Content>,
  TooltipContentProps
>(
  (
    {
      className,
      children,
      shortcut,
      container,
      sideOffset = 8,
      collisionPadding = 8,
      ...props
    },
    ref,
  ) => {
    const portalContainer = usePortalContainer(container);
    return (
    <P.Portal container={portalContainer}>
      <P.Content
        ref={ref}
        data-slot="tooltip-content"
        className={cn(tooltipVariants(), className)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
      >
        {props.asChild && React.isValidElement(children) ? (
          React.cloneElement(
            children as React.ReactElement<{ children?: React.ReactNode | undefined }>,
            {},
            <>
              {(children.props as { children?: React.ReactNode | undefined }).children}
              {shortcut && <Kbd data-slot="tooltip-shortcut">{shortcut}</Kbd>}
            </>,
          )
        ) : (
          <>
            {children}
            {shortcut && <Kbd data-slot="tooltip-shortcut">{shortcut}</Kbd>}
          </>
        )}
      </P.Content>
    </P.Portal>
    );
  },
);
TooltipContent.displayName = "TooltipContent";
export interface TooltipProps extends React.ComponentPropsWithoutRef<
  typeof P.Root
> {
  content?: React.ReactNode | undefined;
  shortcut?: React.ReactNode | undefined;
  side?: TooltipContentProps["side"] | undefined;
  contentProps?: TooltipContentProps | undefined;
}
export function Tooltip({
  content,
  shortcut,
  children,
  side,
  contentProps,
  ...props
}: TooltipProps) {
  return (
    <P.Root {...props}>
      {content !== undefined ? (
        <>
          <TooltipTrigger asChild>{children}</TooltipTrigger>
          <TooltipContent {...(side ? { side } : {})} shortcut={shortcut} {...contentProps}>
            {content}
          </TooltipContent>
        </>
      ) : (
        children
      )}
    </P.Root>
  );
}
export const TooltipArrow = React.forwardRef<
  React.ElementRef<typeof P.Arrow>,
  React.ComponentPropsWithoutRef<typeof P.Arrow>
>(({ className, ...props }, ref) => (
  <P.Arrow
    ref={ref}
    data-slot="tooltip-arrow"
    className={cn("onyx-floating-arrow", className)}
    {...props}
  />
));
TooltipArrow.displayName = "TooltipArrow";
