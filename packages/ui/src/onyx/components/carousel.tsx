/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useControllableState } from "../lib/use-controllable-state";
import { useComposedRefs } from "../lib/compose-refs";
import { Icon } from "./icon";
export const carouselVariants = cva("onyx-carousel");
export interface UseCarouselOptions {
  index?: number | undefined;
  defaultIndex?: number | undefined;
  onIndexChange?: ((index: number) => void) | undefined;
  count?: number | undefined;
}
export function useCarousel({
  index,
  defaultIndex = 0,
  onIndexChange,
  count = 0,
}: UseCarouselOptions = {}) {
  const [rawIndex, setIndex] = useControllableState({
    value: index,
    defaultValue: defaultIndex,
    onChange: onIndexChange,
  });
  const trackRef = React.useRef<HTMLDivElement>(null);
  const scrollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );
  const current = Math.min(Math.max(0, count - 1), Math.max(0, rawIndex));
  const scrollTo = React.useCallback((next: number) => {
    const track = trackRef.current;
    const slide = track?.children[next] as HTMLElement | undefined;
    if (!track || !slide) return;
    track.scrollTo?.({
      left: slide.offsetLeft - track.offsetLeft,
      behavior:
        typeof matchMedia !== "undefined" &&
        matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
    });
  }, []);
  React.useEffect(() => {
    scrollTo(current);
  }, [current, scrollTo]);
  const goTo = (next: number) => {
    const target = Math.min(Math.max(0, count - 1), Math.max(0, next));
    setIndex(target);
    // Scroll only after the rendered (possibly controlled) index changes.
  };
  return {
    index: current,
    count,
    trackRef,
    goTo,
    previous: () => goTo(current - 1),
    next: () => goTo(current + 1),
    canPrevious: current > 0,
    canNext: current < count - 1,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (
        event.defaultPrevented ||
        (event.target !== event.currentTarget &&
          (event.target as HTMLElement).closest(
            "input,textarea,select,[contenteditable=true]",
          ))
      )
        return;
      if (event.key === "ArrowLeft") goTo(current - 1);
      else if (event.key === "ArrowRight") goTo(current + 1);
      else if (event.key === "Home") goTo(0);
      else if (event.key === "End") goTo(count - 1);
      else return;
      event.preventDefault();
    },
    onScroll: () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => {
        const track = trackRef.current;
        if (!track || !count) return;
        const max = track.scrollWidth - track.clientWidth;
        let closest = 0,
          distance = Infinity;
        Array.from(track.children).forEach((child, i) => {
          const left = Math.min(
            max,
            (child as HTMLElement).offsetLeft - track.offsetLeft,
          );
          const delta = Math.abs(left - track.scrollLeft);
          if (delta <= distance) {
            closest = i;
            distance = delta;
          }
        });
        if (closest !== current) {
          setIndex(closest);
          if (index !== undefined) scrollTo(current);
        }
      }, 150);
    },
  };
}
const Context = React.createContext<
  | (ReturnType<typeof useCarousel> & { setCount: (count: number) => void })
  | null
>(null);
function useCarouselContext() {
  const context = React.useContext(Context);
  if (!context) throw new Error("Carousel parts require Carousel");
  return context;
}
export interface CarouselProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    Omit<UseCarouselOptions, "count"> {
  asChild?: boolean;
}
export const Carousel = React.forwardRef<HTMLDivElement, CarouselProps>(
  (
    {
      index,
      defaultIndex,
      onIndexChange,
      asChild,
      onKeyDown,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const [count, setCount] = React.useState(0);
    const model = useCarousel({ index, defaultIndex, onIndexChange, count });
    const Component = asChild ? Slot : "div";
    return (
      <Context.Provider value={{ ...model, setCount }}>
        <Component
          ref={ref}
          data-slot="carousel"
          data-orientation="horizontal"
          role="region"
          aria-roledescription="carousel"
          aria-label="Slides"
          className={cn(carouselVariants(), className)}
          onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
            onKeyDown?.(event);
            model.onKeyDown(event);
          }}
          {...props}
        >
          {children}
        </Component>
      </Context.Provider>
    );
  },
);
export const CarouselContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ asChild, className, children, onScroll, ...props }, forwardedRef) => {
  const model = useCarouselContext();
  const ref = useComposedRefs(forwardedRef, model.trackRef);
  const child =
    asChild && React.isValidElement<{ children?: React.ReactNode | undefined }>(children)
      ? children
      : null;
  const count = React.Children.count(child ? child.props.children : children);
  React.useLayoutEffect(() => {
    model.setCount(count);
  }, [count, model.setCount]);
  const Component = asChild ? Slot : "div";
  return (
    <Component
      ref={ref}
      data-slot="carousel-track"
      tabIndex={0}
      className={cn("onyx-carousel-track", className)}
      onScroll={(event: React.UIEvent<HTMLDivElement>) => {
        onScroll?.(event);
        model.onScroll();
      }}
      {...props}
    >
      {children}
    </Component>
  );
});
export const CarouselItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "div";
  return (
    <Component
      ref={ref}
      data-slot="carousel-slide"
      role="group"
      aria-roledescription="slide"
      className={cn("onyx-carousel-slide", className)}
      {...props}
    />
  );
});
export const CarouselPrevious = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean | undefined }
>(({ className, asChild, onClick, children, ...props }, ref) => {
  const model = useCarouselContext();
  const Component = asChild ? Slot : "button";
  return (
    <Component
      ref={ref}
      type="button"
      data-slot="carousel-previous"
      aria-label="Previous slide"
      disabled={!model.canPrevious}
      className={cn("onyx-carousel-control", className)}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) model.previous();
      }}
      {...props}
    >
      {children ?? <Icon name="chevron-left" />}
    </Component>
  );
});
export const CarouselNext = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean | undefined }
>(({ className, asChild, onClick, children, ...props }, ref) => {
  const model = useCarouselContext();
  const Component = asChild ? Slot : "button";
  return (
    <Component
      ref={ref}
      type="button"
      data-slot="carousel-next"
      aria-label="Next slide"
      disabled={!model.canNext}
      className={cn("onyx-carousel-control", className)}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) model.next();
      }}
      {...props}
    >
      {children ?? <Icon name="chevron-right" />}
    </Component>
  );
});
export const CarouselDots = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, children, ...props }, ref) => {
  const model = useCarouselContext();
  const content = Array.from({ length: model.count }, (_, index) => (
    <button
      key={index}
      type="button"
      data-slot="carousel-dot"
      data-state={model.index === index ? "active" : "idle"}
      aria-label={`Show slide ${index + 1} of ${model.count}`}
      aria-current={model.index === index ? "true" : undefined}
      onClick={() => model.goTo(index)}
    />
  ));
  const Component = asChild ? Slot : "div";
  return (
    <Component
      ref={ref}
      data-slot="carousel-dots"
      role="group"
      aria-label="Choose slide"
      className={cn("onyx-carousel-dots", className)}
      {...props}
    >
      {asChild && React.isValidElement(children)
        ? React.cloneElement(children, {}, content)
        : content}
    </Component>
  );
});
Carousel.displayName = "Carousel";
CarouselContent.displayName = "CarouselContent";
CarouselItem.displayName = "CarouselItem";
CarouselPrevious.displayName = "CarouselPrevious";
CarouselNext.displayName = "CarouselNext";
CarouselDots.displayName = "CarouselDots";
