/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import {
  useFloating,
  autoUpdate,
  flip,
  shift,
  offset,
  size,
  arrow,
  type Placement,
} from '@floating-ui/react-dom';
import { useLayoutEffect, useRef, type RefObject } from 'react';
export interface UseFloatingPositionOptions {
  open?: boolean;
  placement?: Placement;
  offset?: number;
  matchWidth?: boolean;
  arrowRef?: RefObject<HTMLElement | null>;
}
export function useFloatingPosition({
  open,
  placement = 'bottom-start',
  offset: gap = 4,
  matchWidth = false,
  arrowRef,
}: UseFloatingPositionOptions = {}) {
  const matching = useRef(matchWidth);
  matching.current = matchWidth;
  const mounted = useRef(true);
  const ownedWidth = useRef<{ element: HTMLElement; width: string; priority: string } | null>(null);
  const restoreWidth = () => {
    const previous = ownedWidth.current;
    if (previous) previous.element.style.setProperty('width', previous.width, previous.priority);
    ownedWidth.current = null;
  };
  useLayoutEffect(() => {
    mounted.current = true;
    if (!matchWidth) restoreWidth();
    return () => { mounted.current = false; restoreWidth(); };
  }, [matchWidth]);
  return useFloating({
    ...(open === undefined ? {} : { open }),
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(gap),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        // Include the toggle in middleware options so Floating UI detects a change.
        ...{ matchWidth },
        padding: 8,
        apply({ availableWidth, availableHeight, rects, elements }) {
          if (!mounted.current) return;
          const shouldMatch = matching.current;
          if (shouldMatch && ownedWidth.current?.element !== elements.floating) {
            restoreWidth();
            ownedWidth.current = { element: elements.floating, width: elements.floating.style.width, priority: elements.floating.style.getPropertyPriority('width') };
          } else if (!shouldMatch) restoreWidth();
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.max(0, availableWidth)}px`,
            maxHeight: `${Math.max(0, availableHeight)}px`,
            ...(shouldMatch ? { width: `${rects.reference.width}px` } : {}),
          });
        },
      }),
      ...(arrowRef ? [arrow({ element: arrowRef, padding: 8 })] : []),
    ],
  });
}
