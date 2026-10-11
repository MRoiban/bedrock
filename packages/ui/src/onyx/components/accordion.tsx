/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import * as Primitive from "@radix-ui/react-accordion";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useControllableState } from "../lib/use-controllable-state";
import { Icon } from "./icon";
export const accordionVariants = cva("onyx-accordion");
export function useAccordion({
  type = "single",
  value,
  defaultValue = [],
  onValueChange,
  collapsible = false,
}: {
  type?: "single" | "multiple" | undefined;
  value?: readonly string[] | undefined;
  defaultValue?: readonly string[] | undefined;
  onValueChange?: ((value: string[]) => void) | undefined;
  collapsible?: boolean | undefined;
} = {}) {
  const [values, setValues] = useControllableState<readonly string[]>({
    value,
    defaultValue: type === "single" ? defaultValue.slice(0, 1) : defaultValue,
    onChange: (next) => onValueChange?.([...next]),
  });
  return {
    value: values,
    setValue: setValues,
    toggle: (key: string) =>
      setValues((current) =>
        type === "multiple"
          ? current.includes(key)
            ? current.filter((value) => value !== key)
            : [...current, key]
          : current.includes(key)
            ? collapsible
              ? []
              : current
            : [key],
      ),
  };
}
export const Accordion = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Root>
>(({ className, ...props }, ref) => (
  <Primitive.Root
    ref={ref}
    data-slot="accordion"
    className={cn(accordionVariants(), className)}
    {...props}
  />
));
export const AccordionItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Item>
>(({ className, ...props }, ref) => (
  <Primitive.Item
    ref={ref}
    data-slot="accordion-item"
    className={cn("onyx-accordion-item", className)}
    {...props}
  />
));
export const AccordionHeader = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Header>
>(({ className, ...props }, ref) => (
  <Primitive.Header
    ref={ref}
    data-slot="accordion-header"
    className={cn("onyx-accordion-header", className)}
    {...props}
  />
));
export const AccordionTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Trigger> & {
    meta?: React.ReactNode | undefined;
  }
>(({ className, children, meta, asChild = false, ...props }, ref) => (
  <Primitive.Trigger
    ref={ref}
    data-slot="accordion-trigger"
    asChild={asChild}
    className={cn("onyx-accordion-trigger", className)}
    {...props}
  >
    {asChild ? (
      children
    ) : (
      <>
        <Icon data-slot="accordion-chevron" name="chevron-down" />
        {children}
        {meta !== undefined && <span data-slot="accordion-meta">{meta}</span>}
      </>
    )}
  </Primitive.Trigger>
));
export const AccordionContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className, ...props }, ref) => (
  <Primitive.Content
    ref={ref}
    data-slot="accordion-content"
    className={cn(
      "onyx-accordion-content data-[state=open]:animate-accordion-open data-[state=closed]:animate-accordion-close",
      className,
    )}
    {...props}
  />
));
Accordion.displayName = "Accordion";
AccordionItem.displayName = "AccordionItem";
AccordionHeader.displayName = "AccordionHeader";
AccordionTrigger.displayName = "AccordionTrigger";
AccordionContent.displayName = "AccordionContent";
