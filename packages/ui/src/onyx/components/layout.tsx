/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
export type SpaceStep =
  "0-5" | "1" | "1-5" | "2" | "3" | "4" | "5" | "6" | "8" | "10";
export const stackVariants = cva("onyx-stack");
export const inlineVariants = cva("onyx-inline");
export const containerVariants = cva("onyx-container", {
  variants: { size: { sm: "onyx-container--size-sm", md: "onyx-container--size-md", lg: "onyx-container--size-lg", full: "onyx-container--size-full" } },
  defaultVariants: { size: "md" },
});
export const gridVariants = cva("onyx-grid");
export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  gap?: SpaceStep;
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  direction?: "row" | "column" | "row-reverse" | "column-reverse";
}
export function spaceValue(step: SpaceStep) {
  return `var(--onyx-space-${step})`;
}
const axis = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  stretch: "stretch",
  baseline: "baseline",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};
export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  (
    {
      asChild,
      gap,
      align,
      justify,
      direction,
      className,
      style,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="stack"
        data-direction={direction}
        className={cn(stackVariants(), className)}
        style={
          {
            ...(gap !== undefined ? { "--onyx-stack-gap": spaceValue(gap) } : {}),
            ...(align !== undefined ? { "--onyx-stack-align": axis[align] } : {}),
            ...(justify !== undefined ? { "--onyx-stack-justify": axis[justify] } : {}),
            ...(direction !== undefined ? { "--onyx-stack-direction": direction } : {}),
            ...style,
          } as React.CSSProperties
        }
        {...props}
      />
    );
  },
);
Stack.displayName = "Stack";
export const Inline = React.forwardRef<
  HTMLDivElement,
  Omit<StackProps, "direction"> & { wrap?: boolean | undefined }
>(
  (
    {
      asChild,
      gap,
      align,
      justify,
      wrap,
      className,
      style,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="inline"
        data-wrap={wrap}
        className={cn(inlineVariants(), className)}
        style={
          {
            ...(gap !== undefined ? { "--onyx-inline-gap": spaceValue(gap) } : {}),
            ...(align !== undefined ? { "--onyx-inline-align": axis[align] } : {}),
            ...(justify !== undefined ? { "--onyx-inline-justify": axis[justify] } : {}),
            ...(wrap !== undefined ? { "--onyx-inline-wrap": wrap ? "wrap" : "nowrap" } : {}),
            ...style,
          } as React.CSSProperties
        }
        {...props}
      />
    );
  },
);
Inline.displayName = "Inline";
export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  size?: "sm" | "md" | "lg" | "full";
  padding?: SpaceStep;
}
export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  (
    { asChild, size = "md", padding, className, style, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="container"
        data-size={size}
        className={cn(containerVariants({ size }), className)}
        style={
          {
            ...(padding !== undefined ? { "--onyx-container-padding": spaceValue(padding) } : {}),
            ...style,
          } as React.CSSProperties
        }
        {...props}
      />
    );
  },
);
Container.displayName = "Container";
export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  gap?: SpaceStep;
  columns?: number;
  minChildWidth?: string;
}
export const Grid = React.forwardRef<HTMLDivElement, GridProps>(
  (
    {
      asChild,
      gap,
      columns,
      minChildWidth,
      className,
      style,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="grid"
        data-variant={minChildWidth ? "auto-fill" : "columns"}
        className={cn(gridVariants(), className)}
        style={
          {
            ...(gap !== undefined ? { "--onyx-grid-gap": spaceValue(gap) } : {}),
            ...(minChildWidth !== undefined || columns !== undefined ? { "--onyx-grid-columns": minChildWidth
              ? `repeat(auto-fill, minmax(min(100%, ${minChildWidth}), 1fr))`
              : `repeat(${columns !== undefined && Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1}, minmax(0, 1fr))` } : {}),
            ...style,
          } as React.CSSProperties
        }
        {...props}
      />
    );
  },
);
Grid.displayName = "Grid";
