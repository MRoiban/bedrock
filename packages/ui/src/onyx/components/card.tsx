/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
export const cardVariants = cva("onyx-card", {
  variants: { interactive: { true: "onyx-card--interactive", false: "" } },
});
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  interactive?: boolean;
}
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ asChild, interactive, className, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="card"
        data-interactive={interactive || undefined}
        data-state="idle"
        className={cn(cardVariants({ interactive }), className)}
        {...props}
      />
    );
  },
);
Card.displayName = "Card";
export const cardHeaderVariants = cva("onyx-card-header");
export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="card-header"
      className={cn(cardHeaderVariants(), className)}
      {...props}
    />
  );
});
CardHeader.displayName = "CardHeader";
export const cardTitleVariants = cva("onyx-card-title");
export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "h3";
  return (
    <Comp
      ref={ref}
      data-slot="card-title"
      className={cn(cardTitleVariants(), className)}
      {...props}
    />
  );
});
CardTitle.displayName = "CardTitle";
export const cardDescriptionVariants = cva("onyx-card-description");
export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "p";
  return (
    <Comp
      ref={ref}
      data-slot="card-description"
      className={cn(cardDescriptionVariants(), className)}
      {...props}
    />
  );
});
CardDescription.displayName = "CardDescription";
export const cardBodyVariants = cva("onyx-card-body");
export const CardBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="card-body"
      className={cn(cardBodyVariants(), className)}
      {...props}
    />
  );
});
CardBody.displayName = "CardBody";
export const cardFooterVariants = cva("onyx-card-footer");
export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="card-footer"
      className={cn(cardFooterVariants(), className)}
      {...props}
    />
  );
});
CardFooter.displayName = "CardFooter";
export const cardMediaVariants = cva("onyx-card-media");
export const CardMedia = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="card-media"
      className={cn(cardMediaVariants(), className)}
      {...props}
    />
  );
});
CardMedia.displayName = "CardMedia";
