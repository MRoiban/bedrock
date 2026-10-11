/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import * as Primitive from "@radix-ui/react-collapsible";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useControllableState } from "../lib/use-controllable-state";
import { Icon } from "./icon";
export const collapsibleVariants = cva("onyx-collapsible");
export function useCollapsible({
  open,
  defaultOpen = false,
  onOpenChange,
}: {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
} = {}) {
  const [value, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  return { open: value, setOpen, toggle: () => setOpen((current) => !current) };
}
export const Collapsible = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Root>
>(({ className, ...props }, ref) => (
  <Primitive.Root
    ref={ref}
    data-slot="collapsible"
    className={cn(collapsibleVariants(), className)}
    {...props}
  />
));
export const CollapsibleTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Trigger>
>(({ className, children, asChild = false, ...props }, ref) => (
  <Primitive.Trigger
    ref={ref}
    asChild={asChild}
    data-slot="collapsible-trigger"
    className={cn("onyx-collapsible-trigger", className)}
    {...props}
  >
    {asChild ? (
      children
    ) : (
      <>
        <Icon data-slot="collapsible-chevron" name="chevron-down" />
        {children}
      </>
    )}
  </Primitive.Trigger>
));
export const CollapsibleContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className, ...props }, ref) => (
  <Primitive.Content
    ref={ref}
    data-slot="collapsible-content"
    className={cn(
      "onyx-collapsible-content data-[state=open]:animate-collapsible-open data-[state=closed]:animate-collapsible-close",
      className,
    )}
    {...props}
  />
));
Collapsible.displayName = "Collapsible";
CollapsibleTrigger.displayName = "CollapsibleTrigger";
CollapsibleContent.displayName = "CollapsibleContent";
