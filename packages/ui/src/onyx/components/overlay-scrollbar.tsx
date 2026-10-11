/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { cn } from '../lib/cn';
import { useComposedRefs } from '../lib/compose-refs';

export interface OverlayScrollbarMetrics {
  visible: boolean;
  thumbHeight: number;
  thumbOffset: number;
}

/** Geometry for an overlay attached to an existing vertical scrolling viewport. */
export function calculateOverlayScrollbarMetrics({
  clientHeight,
  scrollHeight,
  scrollTop,
  minThumbHeight = 24,
}: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  minThumbHeight?: number | undefined;
}): OverlayScrollbarMetrics {
  if (clientHeight <= 0 || scrollHeight <= clientHeight) {
    return { visible: false, thumbHeight: 0, thumbOffset: 0 };
  }
  const thumbHeight = Math.min(clientHeight, Math.max(minThumbHeight, clientHeight * (clientHeight / scrollHeight)));
  const trackTravel = clientHeight - thumbHeight;
  const thumbOffset = Math.min(trackTravel, Math.max(0, (scrollTop / (scrollHeight - clientHeight)) * trackTravel));
  return { visible: true, thumbHeight, thumbOffset };
}

export interface OverlayScrollbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The existing native scrolling viewport; its scrolling and content remain application owned. */
  scrollElementRef: React.RefObject<HTMLElement | null>;
}

export const OverlayScrollbar = React.forwardRef<HTMLDivElement, OverlayScrollbarProps>(
  ({ scrollElementRef, className, 'aria-label': ariaLabel = 'Scroll position', ...props }, forwardedRef) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    const rootComposedRef = useComposedRefs(forwardedRef, rootRef);
    const thumbRef = React.useRef<HTMLDivElement>(null);
    const viewportId = React.useId();
    const [state, setState] = React.useState({
      visible: false, thumbHeight: 0, thumbOffset: 0, scrollTop: 0, scrollMax: 0, controls: '',
    });
    const [dragging, setDragging] = React.useState(false);
    const dragRef = React.useRef<{
      pointerId: number; startY: number; startScrollTop: number; scrollTravel: number; trackTravel: number;
    } | null>(null);
    const measureRef = React.useRef<() => void>(() => {});

    const cancelDrag = React.useCallback(() => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (drag && thumbRef.current?.hasPointerCapture?.(drag.pointerId)) {
        thumbRef.current.releasePointerCapture(drag.pointerId);
      }
    }, []);

    React.useEffect(() => {
      const viewport = scrollElementRef.current;
      if (!viewport) return;
      const assignedId = !viewport.id;
      if (assignedId) viewport.id = viewportId;
      const measure = () => {
        const scale = Number.parseFloat(getComputedStyle(rootRef.current ?? viewport).getPropertyValue('--onyx-scale-ui'));
        const metrics = calculateOverlayScrollbarMetrics({
          clientHeight: viewport.clientHeight,
          scrollHeight: viewport.scrollHeight,
          scrollTop: viewport.scrollTop,
          minThumbHeight: 24 * (Number.isFinite(scale) && scale > 0 ? scale : 1),
        });
        const next = {
          ...metrics,
          scrollTop: Math.max(0, Math.min(viewport.scrollTop, viewport.scrollHeight - viewport.clientHeight)),
          scrollMax: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
          controls: viewport.id,
        };
        setState(current => Object.keys(next).every(key => current[key as keyof typeof current] === next[key as keyof typeof next]) ? current : next);
        if (!metrics.visible && dragRef.current) cancelDrag();
      };
      measureRef.current = measure;
      viewport.addEventListener('scroll', measure, { passive: true });
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
      const observed = new Set<Element>();
      const observeContent = () => {
        const children = new Set(Array.from(viewport.children));
        for (const previous of observed) if (!children.has(previous)) {
          resize?.unobserve(previous);
          observed.delete(previous);
        }
        for (const child of children) if (!observed.has(child)) {
          resize?.observe(child);
          observed.add(child);
        }
      };
      resize?.observe(viewport);
      if (rootRef.current) resize?.observe(rootRef.current);
      observeContent();
      const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
        observeContent();
        measure();
      });
      mutations?.observe(viewport, { childList: true, subtree: true, characterData: true, attributes: true });
      measure();
      return () => {
        viewport.removeEventListener('scroll', measure);
        resize?.disconnect();
        mutations?.disconnect();
        measureRef.current = () => {};
        cancelDrag();
        if (assignedId && viewport.id === viewportId) viewport.removeAttribute('id');
      };
    }, [scrollElementRef, viewportId, cancelDrag]);

    const setScrollTop = (next: number) => {
      const viewport = scrollElementRef.current;
      if (!viewport) return;
      viewport.scrollTop = Math.max(0, Math.min(next, viewport.scrollHeight - viewport.clientHeight));
      measureRef.current();
    };

    return (
      <div
        {...props}
        ref={rootComposedRef}
        data-slot="overlay-scrollbar"
        data-visible={state.visible ? '' : undefined}
        data-dragging={dragging ? '' : undefined}
        className={cn('onyx-overlay-scrollbar', className)}
        aria-hidden={!state.visible}
      >
        {state.visible && (
          <div
            ref={thumbRef}
            data-slot="overlay-scrollbar-thumb"
            className="onyx-overlay-scrollbar-thumb"
            role="scrollbar"
            tabIndex={0}
            aria-label={ariaLabel}
            aria-orientation="vertical"
            aria-controls={state.controls}
            aria-valuemin={0}
            aria-valuemax={state.scrollMax}
            aria-valuenow={Math.round(state.scrollTop)}
            style={{ height: state.thumbHeight, transform: `translateY(${state.thumbOffset}px)` }}
            onPointerDown={event => {
              if (event.button !== 0 || dragRef.current) return;
              const viewport = scrollElementRef.current;
              if (!viewport) return;
              dragRef.current = {
                pointerId: event.pointerId, startY: event.clientY, startScrollTop: viewport.scrollTop,
                scrollTravel: viewport.scrollHeight - viewport.clientHeight,
                trackTravel: Math.max(1, viewport.clientHeight - state.thumbHeight),
              };
              setDragging(true);
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={event => {
              const drag = dragRef.current;
              if (drag?.pointerId === event.pointerId) {
                setScrollTop(drag.startScrollTop + ((event.clientY - drag.startY) / drag.trackTravel) * drag.scrollTravel);
              }
            }}
            onPointerUp={event => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(); }}
            onPointerCancel={event => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(); }}
            onLostPointerCapture={event => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(); }}
            onKeyDown={event => {
              const viewport = scrollElementRef.current;
              if (!viewport || event.altKey || event.ctrlKey || event.metaKey) return;
              const scale = Number.parseFloat(getComputedStyle(rootRef.current ?? viewport).getPropertyValue('--onyx-scale-ui'));
              const step = 40 * (Number.isFinite(scale) && scale > 0 ? scale : 1);
              let next: number;
              switch (event.key) {
                case 'ArrowDown': next = viewport.scrollTop + step; break;
                case 'ArrowUp': next = viewport.scrollTop - step; break;
                case 'PageDown': next = viewport.scrollTop + viewport.clientHeight; break;
                case 'PageUp': next = viewport.scrollTop - viewport.clientHeight; break;
                case 'Home': next = 0; break;
                case 'End': next = viewport.scrollHeight - viewport.clientHeight; break;
                default: return;
              }
              event.preventDefault();
              setScrollTop(next);
            }}
          />
        )}
      </div>
    );
  },
);
OverlayScrollbar.displayName = 'OverlayScrollbar';
