/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import * as Primitive from "@radix-ui/react-avatar";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { StatusDot, displayAttributes, type DisplayTone } from "./badge";
export const avatarVariants = cva("onyx-avatar", {
  variants: {
    size: { sm: "onyx-avatar--size-sm", md: "onyx-avatar--size-md", lg: "onyx-avatar--size-lg" },
    variant: { circle: "onyx-avatar--variant-circle", square: "onyx-avatar--variant-square" },
  },
  defaultVariants: { size: "md", variant: "circle" },
});
export const avatarImageVariants = cva("onyx-avatar-image");
export const avatarFallbackVariants = cva("onyx-avatar-fallback");
export const avatarGroupVariants = cva("onyx-avatar-group");
export function avatarAttributes({ size = "md", variant = "circle" }: Pick<AvatarProps, "size" | "variant"> = {}) {
  return displayAttributes({ size, variant });
}
function firstGrapheme(value: string) {
  if (typeof Intl.Segmenter === "function")
    return new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)[Symbol.iterator]().next().value?.segment ?? "";
  // Combining marks, variation selectors, emoji modifiers, flags and ZWJ sequences.
  return value.match(/^(?:[\u{1F1E6}-\u{1F1FF}]{2}|[^\p{M}])(?:[\p{M}\u{FE0F}\u{1F3FB}-\u{1F3FF}]*)(?:\u{200D}[^\p{M}][\p{M}\u{FE0F}\u{1F3FB}-\u{1F3FF}]*)*/u)?.[0] ?? "";
}
export function getAvatarInitials(name = "") {
  const parts = name.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  return parts.length
    ? (firstGrapheme(parts[0]!) + (parts.length > 1 ? firstGrapheme(parts[parts.length - 1]!) : "")).toLocaleUpperCase()
    : "?";
}
export interface AvatarProps extends React.ComponentPropsWithoutRef<
  typeof Primitive.Root
> {
  name?: string | undefined;
  src?: string | undefined;
  alt?: string | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  variant?: "circle" | "square" | undefined;
  status?: DisplayTone | undefined;
  statusLabel?: string | undefined;
}
export const Avatar = React.forwardRef<
  React.ElementRef<typeof Primitive.Root>,
  AvatarProps
>(
  (
    {
      name,
      src,
      alt,
      size = "md",
      variant = "circle",
      status,
      statusLabel,
      children,
      asChild = false,
      className,
      ...props
    },
    ref,
  ) => (
    <Primitive.Root
      ref={ref}
      asChild={asChild}
      data-slot="avatar"
      data-size={size}
      data-variant={variant}
      className={cn(avatarVariants({ size, variant }), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {children ?? (
            <>
              {src && <AvatarImage src={src} alt={alt ?? name ?? ""} />}
              <AvatarFallback aria-label={name}>
                {getAvatarInitials(name)}
              </AvatarFallback>
            </>
          )}
          {status && (
            <StatusDot
              data-slot="avatar-status"
              tone={status}
              label={statusLabel ?? `${name ?? "User"}: ${status}`}
            />
          )}
        </>
      )}
    </Primitive.Root>
  ),
);
Avatar.displayName = "Avatar";
export const AvatarImage = React.forwardRef<
  React.ElementRef<typeof Primitive.Image>,
  React.ComponentPropsWithoutRef<typeof Primitive.Image>
>(({ className, ...props }, ref) => (
  <Primitive.Image
    ref={ref}
    data-slot="avatar-image"
    className={cn(avatarImageVariants(), className)}
    {...props}
  />
));
export const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof Primitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof Primitive.Fallback>
>(({ className, ...props }, ref) => (
  <Primitive.Fallback
    ref={ref}
    data-slot="avatar-fallback"
    className={cn(avatarFallbackVariants(), className)}
    {...props}
  />
));
AvatarImage.displayName = "AvatarImage";
AvatarFallback.displayName = "AvatarFallback";
export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  max?: number;
}
export const AvatarGroup = React.forwardRef<HTMLDivElement, AvatarGroupProps>(
  ({ asChild, max = Infinity, children, className, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    const all = React.Children.toArray(children);
    const count = Math.max(0, max);
    return (
      <Comp
        ref={ref}
        data-slot="avatar-group"
        role="group"
        className={cn(avatarGroupVariants(), className)}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {all.slice(0, count)}
            {all.length > count && (
              <Avatar aria-label={`${all.length - count} more people`}>
                <AvatarFallback>+{all.length - count}</AvatarFallback>
              </Avatar>
            )}
          </>
        )}
      </Comp>
    );
  },
);
AvatarGroup.displayName = "AvatarGroup";
