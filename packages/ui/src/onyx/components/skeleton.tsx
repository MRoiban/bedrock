/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
export const skeletonVariants = cva(
  "onyx-skeleton animate-onyx-shimmer motion-reduce:animate-none",
  {
    variants: { shape: { text: "onyx-skeleton--shape-text", "text-line": "onyx-skeleton--shape-text-line", circle: "onyx-skeleton--shape-circle", rect: "onyx-skeleton--shape-rect" } },
    defaultVariants: { shape: "text" },
  },
);
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  shape?: "text" | "text-line" | "circle" | "rect";
}
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ asChild, shape = "text", className, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="skeleton"
        data-variant={shape}
        data-state="loading"
        aria-hidden="true"
        className={cn(skeletonVariants({ shape }), className)}
        {...props}
      />
    );
  },
);
Skeleton.displayName = "Skeleton";
