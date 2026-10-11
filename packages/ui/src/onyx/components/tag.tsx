/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useRovingFocus } from "../lib/use-roving-focus";
import { useComposedRefs } from "../lib/compose-refs";
import { useRemovalFocus } from "../lib/use-removal-focus";
import { Icon } from "./icon";
import { displayToneClasses, type DisplayTone } from "./badge";
export const tagVariants = cva("onyx-tag onyx-display-tone", {
  variants: { tone: displayToneClasses },
  defaultVariants: { tone: "neutral" },
});
export const tagGroupVariants = cva("onyx-tag-group");
export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  asChild?: boolean | undefined;
  tone?: DisplayTone | undefined;
  onRemove?: (() => void) | undefined;
  removeLabel?: string | undefined;
  disabled?: boolean | undefined;
}
export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  (
    {
      asChild,
      tone = "neutral",
      onRemove,
      removeLabel,
      disabled,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "span";
    return (
      <Comp
        ref={ref}
        data-slot="tag"
        data-tone={tone}
        data-disabled={disabled || undefined}
        data-state="idle"
        className={cn(tagVariants({ tone }), className)}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            <span data-slot="tag-label">{children}</span>
            {onRemove && (
              <button
                data-slot="tag-remove"
                type="button"
                disabled={disabled}
                aria-label={
                  removeLabel ??
                  `Remove ${typeof children === "string" ? children : "tag"}`
                }
                onClick={onRemove}
              >
                <Icon name="close" size="sm" />
              </button>
            )}
          </>
        )}
      </Comp>
    );
  },
);
Tag.displayName = "Tag";
export interface TagGroupOptions {
  onEmpty?: (() => void) | undefined;
  fallbackRef?: React.RefObject<HTMLElement | null> | undefined;
}
export function useTagGroup(options: TagGroupOptions = {}) {
  const roving = useRovingFocus<HTMLDivElement>({
    orientation: "horizontal",
    selector: '[data-slot="tag-remove"]',
  });
  const removal = useRemovalFocus(roving.ref, '[data-slot="tag"]', options);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (event.key === "Backspace" || event.key === "Delete") {
      const items = roving.getItems();
      const current = items.indexOf(event.target as HTMLElement);
      if (current < 0) return;
      event.preventDefault();
      (items[current] as HTMLButtonElement).click();

    } else roving.onKeyDown(event);
  };
  return { ...roving, onKeyDown, onFocusCapture: (event: React.FocusEvent<HTMLDivElement>) => { removal.captureFocus(event); roving.onFocusCapture(event); } };
}
export const TagGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & TagGroupOptions & { asChild?: boolean | undefined }
>(
  (
    { asChild, className, onKeyDown, onFocusCapture, onEmpty, fallbackRef, ...props },
    forwardedRef,
  ) => {
    const model = useTagGroup({ onEmpty, fallbackRef });
    const ref = useComposedRefs(forwardedRef, model.ref);
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        role="group"
        tabIndex={-1}
        data-slot="tag-group"
        className={cn(tagGroupVariants(), className)}
        {...props}
        onFocusCapture={(e: React.FocusEvent<HTMLDivElement>) => {
          onFocusCapture?.(e);
          if (!e.defaultPrevented) model.onFocusCapture(e);
        }}
        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
          onKeyDown?.(e);
          model.onKeyDown(e);
        }}
      />
    );
  },
);
TagGroup.displayName = "TagGroup";
