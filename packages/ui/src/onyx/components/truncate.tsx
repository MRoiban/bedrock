/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useComposedRefs } from "../lib/compose-refs";
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  type TooltipProps,
} from "./tooltip";

export const truncateVariants = cva("onyx-truncate");
/** Observe both available space and the full text, including font/content changes. */
export function useTruncate(text: string) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const measureRef = React.useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = React.useState(false);
  React.useLayoutEffect(() => {
    const element = ref.current;
    const measure = measureRef.current;
    if (!element || !measure) return;
    let mounted = true;
    const update = () => {
      if (mounted) setOverflowing(measure.scrollWidth > element.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(measure);
    document.fonts?.ready.then(update);
    return () => {
      mounted = false;
      observer.disconnect();
    };
  }, [text]);
  return { ref, measureRef, overflowing };
}
export interface TruncateProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "children"
> {
  text?: string;
  children?: string | React.ReactElement;
  asChild?: boolean;
  mode?: "end" | "middle";
  /** Number of trailing characters kept visible in middle mode. */
  endCharacters?: number;
  tooltipProps?: Omit<TooltipProps, "content" | "children">;
}
export const Truncate = React.forwardRef<HTMLSpanElement, TruncateProps>(
  (
    {
      text: explicitText,
      children,
      asChild,
      mode = "end",
      endCharacters = 12,
      className,
      tooltipProps,
      tabIndex,
      ...props
    },
    forwardedRef,
  ) => {
    const text = explicitText ?? (typeof children === "string" ? children : "");
    const { ref, measureRef, overflowing } = useTruncate(text);
    const composed = useComposedRefs(forwardedRef, ref);
    const Comp = asChild ? Slot : "span";
    const tail = Math.max(0, Math.min(endCharacters, text.length));
    const content = (
      <>
        <span
          ref={measureRef}
          data-slot="truncate-measure"
          aria-hidden="true"
          style={{
            position: "absolute",
            visibility: "hidden",
            width: "max-content",
            pointerEvents: "none",
          }}
        >
          {text}
        </span>
        {mode === "middle" ? (
          <>
            <span data-slot="truncate-start" className="onyx-truncate-start">
              {text.slice(0, text.length - tail)}
            </span>
            <span data-slot="truncate-end" className="onyx-truncate-end">
              {text.slice(text.length - tail)}
            </span>
          </>
        ) : (
          <span data-slot="truncate-text">{text}</span>
        )}
      </>
    );
    const element = (
      <Comp
        ref={composed}
        data-slot="truncate"
        data-mode={mode}
        data-state={overflowing ? "overflowing" : "idle"}
        aria-label={mode === "middle" ? text : undefined}
        tabIndex={tabIndex ?? (overflowing ? 0 : undefined)}
        className={cn(truncateVariants(), className)}
        {...props}
      >
        {asChild && React.isValidElement(children)
          ? React.cloneElement(
              children as React.ReactElement<{ children?: React.ReactNode | undefined }>,
              {},
              content,
            )
          : content}
      </Comp>
    );
    return (
      <TooltipProvider>
        <TooltipRoot
          {...tooltipProps}
          {...(overflowing ? {} : { open: false })}
        >
          <TooltipTrigger asChild>{element}</TooltipTrigger>
          {overflowing && (
            <TooltipContent
              {...(tooltipProps?.side ? { side: tooltipProps.side } : {})}
              {...tooltipProps?.contentProps}
            >
              {text}
            </TooltipContent>
          )}
        </TooltipRoot>
      </TooltipProvider>
    );
  },
);
Truncate.displayName = "Truncate";
