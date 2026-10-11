/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import * as Primitive from "@radix-ui/react-scroll-area";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useComposedRefs } from "../lib/compose-refs";
export const scrollAreaVariants = cva("onyx-scroll-area");
const Edges = React.createContext<
  ((edges: { top: boolean; bottom: boolean }) => void) | null
>(null);
export interface ScrollAreaRootProps extends React.ComponentPropsWithoutRef<
  typeof Primitive.Root
> {
  edgeShadows?: boolean | undefined;
}
export const ScrollAreaRoot = React.forwardRef<
  HTMLDivElement,
  ScrollAreaRootProps
>(
  (
    { className, children, edgeShadows, type = "hover", asChild = false, ...props },
    ref,
  ) => {
    const [edges, setEdges] = React.useState({ top: false, bottom: false });
    return (
      <Edges.Provider value={setEdges}>
        <Primitive.Root
          ref={ref}
          data-slot="scroll-area"
          type={type}
          asChild={asChild}
          data-scrolled-top={edges.top ? "" : undefined}
          data-scrolled-bottom={edges.bottom ? "" : undefined}
          className={cn(scrollAreaVariants(), className)}
          {...props}
        >
          {asChild ? (
            children
          ) : (
            <>
              {children}
              {edgeShadows && (
                <>
                  <span
                    data-slot="scroll-area-shadow-top"
                    data-visible={edges.top}
                    aria-hidden="true"
                  />
                  <span
                    data-slot="scroll-area-shadow-bottom"
                    data-visible={edges.bottom}
                    aria-hidden="true"
                  />
                </>
              )}
            </>
          )}
        </Primitive.Root>
      </Edges.Provider>
    );
  },
);
export const ScrollAreaViewport = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Viewport>
>(({ className, onScroll, ...props }, forwardedRef) => {
  const setEdges = React.useContext(Edges);
  const localRef = React.useRef<HTMLDivElement>(null);
  const ref = useComposedRefs(forwardedRef, localRef);
  const update = React.useCallback(() => {
    const el = localRef.current;
    if (el)
      setEdges?.({
        top: el.scrollTop > 0,
        bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      });
  }, [setEdges]);
  React.useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    update();
    const resize = new ResizeObserver(update);
    resize.observe(el);
    if (el.firstElementChild) resize.observe(el.firstElementChild);
    const mutations = new MutationObserver(update);
    mutations.observe(el, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [update]);
  return (
    <Primitive.Viewport
      ref={ref}
      data-slot="scroll-area-viewport"
      className={cn("onyx-scroll-area-viewport", className)}
      onScroll={(event) => {
        onScroll?.(event);
        update();
      }}
      {...props}
    />
  );
});
export const ScrollAreaThumb = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Thumb>
>(({ className, ...props }, ref) => (
  <Primitive.Thumb
    ref={ref}
    data-slot="scroll-area-thumb"
    className={cn("onyx-scroll-area-thumb", className)}
    {...props}
  />
));
export const ScrollAreaScrollbar = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Scrollbar>
>(
  (
    { className, children, orientation = "vertical", asChild = false, ...props },
    ref,
  ) => (
    <Primitive.Scrollbar
      ref={ref}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      data-orientation={orientation}
      asChild={asChild}
      className={cn("onyx-scroll-area-scrollbar", className)}
      {...props}
    >
      {children ?? <ScrollAreaThumb />}
    </Primitive.Scrollbar>
  ),
);
export const ScrollAreaCorner = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Primitive.Corner>
>(({ className, ...props }, ref) => (
  <Primitive.Corner
    ref={ref}
    data-slot="scroll-area-corner"
    className={cn("onyx-scroll-area-corner", className)}
    {...props}
  />
));
export interface ScrollAreaProps extends ScrollAreaRootProps {
  viewportProps?: React.ComponentPropsWithRef<typeof ScrollAreaViewport> | undefined;
  horizontal?: boolean | undefined;
}
export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ children, viewportProps, horizontal = false, asChild = false, ...props }, ref) => (
    <ScrollAreaRoot ref={ref} asChild={asChild} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          <ScrollAreaViewport {...viewportProps}>{children}</ScrollAreaViewport>
          <ScrollAreaScrollbar />
          {horizontal && (
            <>
              <ScrollAreaScrollbar orientation="horizontal" />
              <ScrollAreaCorner />
            </>
          )}
        </>
      )}
    </ScrollAreaRoot>
  ),
);
ScrollArea.displayName = "ScrollArea";
ScrollAreaRoot.displayName = "ScrollAreaRoot";
ScrollAreaViewport.displayName = "ScrollAreaViewport";
ScrollAreaThumb.displayName = "ScrollAreaThumb";
ScrollAreaScrollbar.displayName = "ScrollAreaScrollbar";
ScrollAreaCorner.displayName = "ScrollAreaCorner";
