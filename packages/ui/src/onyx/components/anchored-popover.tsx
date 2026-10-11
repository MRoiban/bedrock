/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { Popover, PopoverAnchor, PopoverContent } from './popover';
import { isFocusableCandidate } from '../lib/use-roving-focus';

export interface AnchoredPopoverProps extends Omit<React.ComponentPropsWithoutRef<typeof PopoverContent>, 'forceMount'> {
  /** An existing element owned by the caller; no trigger or anchor DOM is added. */
  anchor: HTMLElement | null;
  /** Defaults to true for callers that mount the surface conditionally. */
  open?: boolean;
  onOpenChange: (open: boolean) => void;
}

const TABBABLE = 'button, a[href], input, select, textarea, [tabindex], [contenteditable]:not([contenteditable="false"])';

/** Match the browser's positive-tabindex-first order, skipping hidden/disabled controls. */
function tabbableElements(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE))
    .filter(element => element.tabIndex >= 0 && isFocusableCandidate(element))
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}

/**
 * An interactive, nonmodal popover attached to an existing DOM control.
 * Radix owns collision handling, scroll/resize updates, focus scope and dismissal.
 */
export const AnchoredPopover = React.forwardRef<HTMLDivElement, AnchoredPopoverProps>(
  ({ anchor, open = true, onOpenChange, onInteractOutside, onCloseAutoFocus,
    onOpenAutoFocus, onEscapeKeyDown, onKeyDown, children, ...props }, ref) => {
    const anchorRef = React.useRef<HTMLElement | null>(anchor);
    anchorRef.current = anchor;
    const leavingFocus = React.useRef(false);

    if (!anchor) return null;

    return (
      <Popover open={open} onOpenChange={onOpenChange} modal={false}>
        <PopoverAnchor virtualRef={anchorRef} />
        <PopoverContent
          {...props}
          ref={ref}
          data-slot="anchored-popover"
          onOpenAutoFocus={event => {
            leavingFocus.current = false;
            onOpenAutoFocus?.(event);
          }}
          onInteractOutside={event => {
            // The external anchor is not a Radix Trigger, so supply its branch explicitly.
            if (event.target instanceof Node && anchor.contains(event.target)) {
              event.preventDefault();
              return;
            }
            onInteractOutside?.(event);
            if (!event.defaultPrevented) leavingFocus.current = true;
          }}
          onEscapeKeyDown={event => {
            onEscapeKeyDown?.(event);
            if (!event.defaultPrevented) leavingFocus.current = false;
          }}
          onCloseAutoFocus={event => {
            onCloseAutoFocus?.(event);
            if (!event.defaultPrevented) {
              event.preventDefault();
              if (!leavingFocus.current && isFocusableCandidate(anchor)) anchor.focus({ preventScroll: true });
            }
            leavingFocus.current = false;
          }}
          onKeyDown={event => {
            onKeyDown?.(event);
            if (event.defaultPrevented || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
            const surface = event.currentTarget;
            const active = surface.ownerDocument.activeElement;
            if (!active || !surface.contains(active)) return; // A nested portalled layer owns its own keys.
            const controls = tabbableElements(surface);
            const edge = event.shiftKey ? controls[0] : controls[controls.length - 1];
            if (controls.length && active !== edge && !(event.shiftKey && active === surface)) return;

            // Radix Popover loops Tab by default. A nonmodal external-anchor surface
            // instead rejoins the page's tab order at the anchor's position.
            const pageControls = tabbableElements(surface.ownerDocument).filter(element => !surface.contains(element));
            const anchorIndex = pageControls.indexOf(anchor);
            const next = event.shiftKey ? anchor : pageControls[anchorIndex + 1] ?? pageControls[0] ?? anchor;
            event.preventDefault();
            leavingFocus.current = true;
            onOpenChange(false);
            // Let the caller's controlled close commit before the next focus event.
            // Otherwise that event could request the same dismissal a second time.
            queueMicrotask(() => {
              if (isFocusableCandidate(next)) next.focus({ preventScroll: true });
            });
          }}
        >
          {children}
        </PopoverContent>
      </Popover>
    );
  },
);
AnchoredPopover.displayName = 'AnchoredPopover';
