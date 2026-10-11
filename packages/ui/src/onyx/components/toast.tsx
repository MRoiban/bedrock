/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { Icon } from "./icon";
import { toneIcons } from "./alert";
import { displayToneClasses, type DisplayTone } from "./badge";
import { cn } from "../lib/cn";
import { useRemovalFocus } from "../lib/use-removal-focus";
import { useComposedRefs } from "../lib/compose-refs";

export const ToastViewport = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="toast-viewport"
      className={cn("toast-container onyx-toast-viewport", className)}
      {...props}
    />
  );
});
ToastViewport.displayName = "ToastViewport";

export const ToastRoot = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    asChild?: boolean | undefined;
    tone?: DisplayTone | undefined;
  }
>(({ className, asChild, tone = "neutral", ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="toast"
      data-tone={tone}
      className={cn("toast", toastVariants({ tone }), className)}
      {...props}
    />
  );
});
ToastRoot.displayName = "ToastRoot";

export const ToastContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="toast-content"
      className={cn("toast-content onyx-toast-content", className)}
      {...props}
    />
  );
});
ToastContent.displayName = "ToastContent";

export const ToastIcon = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="toast-icon"
      className={cn("toast-icon onyx-toast-icon", className)}
      {...props}
    />
  );
});
ToastIcon.displayName = "ToastIcon";

export const ToastMessage = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="toast-message"
      className={cn("toast-message onyx-toast-message", className)}
      {...props}
    />
  );
});
ToastMessage.displayName = "ToastMessage";

export const ToastSource = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="toast-source"
      className={cn("toast-source onyx-toast-source", className)}
      {...props}
    />
  );
});
ToastSource.displayName = "ToastSource";

export const ToastText = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="toast-text"
      className={cn("toast-text onyx-toast-text", className)}
      {...props}
    />
  );
});
ToastText.displayName = "ToastText";

export const ToastClose = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean | undefined }
>(({ className, asChild, type = "button", ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-slot="toast-close"
      className={cn("toast-close onyx-toast-close", className)}
      type={type}
      {...props}
    />
  );
});
ToastClose.displayName = "ToastClose";

export const ToastActions = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="toast-actions"
      className={cn("toast-actions onyx-toast-actions", className)}
      {...props}
    />
  );
});
ToastActions.displayName = "ToastActions";

export interface ToastProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  asChild?: boolean;
}

export const ToastProgress = React.forwardRef<
  HTMLDivElement,
  ToastProgressProps
>(({ className, value, asChild, children, ...props }, ref) => {
  const normalizedValue = Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 0;

  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="toast-progress"
      className={cn("toast-progress onyx-toast-progress", className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <div
          data-slot="toast-progress-bar"
          className="toast-progress-bar onyx-toast-progress-bar"
          style={{ width: `${normalizedValue}%` }}
        />
      )}
    </Comp>
  );
});
ToastProgress.displayName = "ToastProgress";

export const toastVariants = cva("onyx-toast onyx-display-tone", {
  variants: { tone: displayToneClasses },
  defaultVariants: { tone: "neutral" },
});
export const toastViewportVariants = cva("onyx-toast-viewport", {
  variants: { variant: { inline: "onyx-toast-viewport--variant-inline", fixed: "onyx-toast-viewport--variant-fixed" }, state: { expanded: "onyx-toast-viewport--state-expanded", stacked: "onyx-toast-viewport--state-stacked" } },
  defaultVariants: { variant: "fixed", state: "stacked" },
});
export const toastContentVariants = cva("onyx-toast-content");
export const toastIconVariants = cva("onyx-toast-icon");
export const toastMessageVariants = cva("onyx-toast-message");
export const toastSourceVariants = cva("onyx-toast-source");
export const toastTextVariants = cva("onyx-toast-text");
export const toastCloseVariants = cva("onyx-toast-close");
export const toastActionsVariants = cva("onyx-toast-actions");
export const toastProgressVariants = cva("onyx-toast-progress");
export interface ToastOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  tone?: DisplayTone;
  action?: React.ReactNode;
  duration?: number;
}
export interface ToastEntry extends ToastOptions {
  id: string;
}
export interface ToastQueueOptions {
  maxVisible?: number;
  duration?: number;
  initialToasts?: ToastOptions[];
}
interface TimerState {
  remaining: number;
  started?: number;
  timer?: ReturnType<typeof setTimeout>;
}
let toastSequence = 0;
export function useToastQueue({
  maxVisible = 3,
  duration = 5000,
  initialToasts = [],
}: ToastQueueOptions = {}) {
  const [toasts, setToasts] = React.useState<ToastEntry[]>(() =>
    initialToasts.map((t) => ({ ...t, id: `onyx-toast-${++toastSequence}` })),
  );
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [windowPaused, setWindowPaused] = React.useState(false);
  const [environmentReady, setEnvironmentReady] = React.useState(false);
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [announcements, setAnnouncements] = React.useState<ToastEntry[]>(() => toasts);
  const entriesRef = React.useRef(toasts);
  entriesRef.current = toasts;
  const timers = React.useRef(new Map<string, TimerState>());
  const paused = !environmentReady || hovered || focused || windowPaused;
  const limit = Number.isFinite(maxVisible) ? Math.max(1, Math.floor(maxVisible)) : 3;
  const visible = toasts.slice(-limit);
  const pinned = toasts.find(t => t.id === focusedId);
  if (pinned && !visible.includes(pinned)) { visible.shift(); visible.unshift(pinned); }
  const toast = React.useCallback((options: ToastOptions) => {
    const id = `onyx-toast-${++toastSequence}`;
    const entry = { ...options, id };
    entriesRef.current = [...entriesRef.current, entry];
    setToasts((all) => [...all, entry]);
    setAnnouncements(all => [...all, entry]);
    return id;
  }, []);
  const dismiss = React.useCallback(
    (id?: string) => {
      entriesRef.current = id ? entriesRef.current.filter(t => t.id !== id) : [];
      setToasts((all) => (id ? all.filter((t) => t.id !== id) : []));
    },
    [],
  );
  const update = React.useCallback(
    (id: string, options: Partial<ToastOptions>) => {
      const current = entriesRef.current.find(t => t.id === id);
      if (current) {
        const updated = { ...current, ...options };
        entriesRef.current = entriesRef.current.map(t => t.id === id ? updated : t);
        setAnnouncements(all => [...all, updated]);
      }
      if (options.duration !== undefined) {
        const old = timers.current.get(id);
        if (old?.timer) clearTimeout(old.timer);
        timers.current.set(id, { remaining: options.duration });
      }
      setToasts((all) =>
        all.map((t) => (t.id === id ? { ...t, ...options } : t)),
      );
    },
    [],
  );
  React.useEffect(() => {
    setWindowPaused(document.hidden);
    setEnvironmentReady(true);
    const blur = () => setWindowPaused(true);
    const focus = () => setWindowPaused(document.hidden);
    const visibility = () => setWindowPaused(document.hidden);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  React.useEffect(() => {
    const active = new Set(toasts.map((t) => t.id));
    for (const [id, timer] of timers.current)
      if (!active.has(id)) {
        if (timer.timer) clearTimeout(timer.timer);
        timers.current.delete(id);
      }
    for (const entry of visible) {
      let timer = timers.current.get(entry.id);
      if (!timer) {
        timer = { remaining: entry.duration ?? duration };
        timers.current.set(entry.id, timer);
      }
      if (
        !paused &&
        Number.isFinite(timer.remaining) &&
        (entry.duration ?? duration) > 0
      ) {
        timer.started = Date.now();
        const scheduleChunk = () => {
          const delay = Math.min(0x7fffffff, timer!.remaining);
          timer!.timer = setTimeout(() => {
            timer!.remaining = Math.max(0, timer!.remaining - (Date.now() - timer!.started!));
            timer!.started = Date.now();
            if (timer!.remaining <= 0) dismiss(entry.id);
            else scheduleChunk();
          }, delay);
        };
        scheduleChunk();
      }
    }
    return () => {
      for (const timer of timers.current.values())
        if (timer.started !== undefined) {
          clearTimeout(timer.timer);
          timer.remaining = Math.max(
            0,
            timer.remaining - (Date.now() - timer.started),
          );
          delete timer.started;
          delete timer.timer;
        }
    };
  }, [toasts, paused, maxVisible, duration, dismiss, focusedId]);
  return {
    remaining: (id: string) => {
      const timer = timers.current.get(id);
      return timer
        ? Math.max(
            0,
            timer.remaining -
              (timer.started === undefined ? 0 : Date.now() - timer.started),
          )
        : duration;
    },
    defaultDuration: duration,
    toasts,
    visible,
    toast,
    update,
    dismiss,
    paused,
    expanded: hovered || focused,
    setHovered,
    setFocused,
    setFocusedId,
    announcements,
    consumeAnnouncement: React.useCallback(() => setAnnouncements(all => all.slice(1)), []),
  };
}
export type ToastQueue = ReturnType<typeof useToastQueue>;
const ToastContext = React.createContext<ToastQueue | null>(null);
export function useToast() {
  const queue = React.useContext(ToastContext);
  if (!queue) throw new Error("useToast must be used within ToastProvider");
  return queue;
}
export interface ToastProviderProps extends ToastQueueOptions {
  children: React.ReactNode;
  viewport?: boolean;
  inline?: boolean;
  label?: string;
}
export function ToastProvider({
  children,
  viewport = true,
  inline = false,
  label = "Notifications",
  ...options
}: ToastProviderProps) {
  const queue = useToastQueue(options);
  return (
    <ToastContext.Provider value={queue}>
      {children}
      <ToastAnnouncer queue={queue} />
      {viewport && <ToastQueueViewport inline={inline} label={label} />}
    </ToastContext.Provider>
  );
}
function ToastAnnouncer({ queue }: { queue: ToastQueue }) {
  const [message, setMessage] = React.useState<ToastEntry | null>(null);
  const next = queue.announcements[0];
  React.useEffect(() => {
    if (!next) return;
    setMessage(null);
    const show = setTimeout(() => setMessage(next), 50);
    const advance = setTimeout(queue.consumeAnnouncement, 700);
    return () => { clearTimeout(show); clearTimeout(advance); };
  }, [next, queue.consumeAnnouncement]);
  return <div data-slot="toast-live" className="onyx-toast-live" role="status" aria-live="polite" aria-atomic="true">
    {message?.title}{message?.description && <span data-slot="toast-live-description"> — {message.description}</span>}
  </div>;
}
export interface ToastQueueViewportProps extends React.HTMLAttributes<HTMLDivElement> {
  inline?: boolean;
  label?: string;
}
export const ToastQueueViewport = React.forwardRef<
  HTMLDivElement,
  ToastQueueViewportProps
>(({ inline, label = "Notifications", className, ...props }, ref) => {
  const queue = useToast();
  const localRef = React.useRef<HTMLDivElement>(null);
  const composedRef = useComposedRefs(ref, localRef);
  const removal = useRemovalFocus(localRef, '[data-slot="toast"]', { returnToPrevious: true });
  React.useLayoutEffect(() => {
    removal.restore();
    if (!localRef.current?.contains(document.activeElement)) {
      queue.setFocused(false);
      queue.setFocusedId(null);
    }
  }, [queue.toasts, queue.setFocused, queue.setFocusedId, removal.restore]);
  return (
      <ToastViewport
        ref={composedRef}
        role="region"
        aria-label={label}
        data-variant={inline ? "inline" : "fixed"}
        data-state={queue.expanded ? "expanded" : "stacked"}
        data-paused={queue.paused || undefined}
        className={className}
        {...props}
        onMouseEnter={(e) => {
          props.onMouseEnter?.(e);
          queue.setHovered(true);
        }}
        onMouseLeave={(e) => {
          props.onMouseLeave?.(e);
          queue.setHovered(false);
        }}
        onFocusCapture={(e) => {
          props.onFocusCapture?.(e);
          removal.captureFocus(e);
          queue.setFocused(true);
          queue.setFocusedId((e.target as HTMLElement).closest('[data-toast-id]')?.getAttribute('data-toast-id') ?? null);
        }}
        onBlurCapture={(e) => {
          props.onBlurCapture?.(e);
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            queue.setFocused(false);
            queue.setFocusedId(null);
          }
        }}
        onKeyDown={(e) => {
          props.onKeyDown?.(e);
          if (!e.defaultPrevented && e.key === "Escape") {
            e.preventDefault();
            const last = queue.visible[queue.visible.length - 1];
            if (last) queue.dismiss(last.id);
          }
        }}
      >
        {queue.visible.map((entry, i) => (
          <QueuedToast
            key={entry.id}
            entry={entry}
            index={queue.visible.length - 1 - i}
            queue={queue}
          />
        ))}
      </ToastViewport>
  );
});
ToastQueueViewport.displayName = "ToastQueueViewport";
function QueuedToast({
  entry,
  index,
  queue,
}: {
  entry: ToastEntry;
  index: number;
  queue: ToastQueue;
}) {
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const lifetime = entry.duration ?? queue.defaultDuration;
  const [progress, setProgress] = React.useState(100);
  React.useEffect(() => {
    if (!Number.isFinite(lifetime) || lifetime <= 0 || queue.paused) return;
    const timer = setInterval(
      () => setProgress((queue.remaining(entry.id) / lifetime) * 100),
      100,
    );
    return () => clearInterval(timer);
  }, [entry.id, lifetime, queue.paused, queue.remaining]);
  const background = index > 0 && !queue.expanded;
  return (
    <ToastRoot
      tone={entry.tone ?? "neutral"}
      data-toast-id={entry.id}
      data-state="open"
      data-background={background || undefined}
      aria-hidden={background || undefined}
      inert={background || undefined}
      style={{ "--onyx-toast-index": index } as React.CSSProperties}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button, a, input")) return;
        start.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onPointerUp={(e) => {
        if (
          start.current &&
          Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >
            60
        )
          queue.dismiss(entry.id);
        start.current = null;
      }}
    >
      <ToastIcon>
        <Icon name={toneIcons[entry.tone ?? "neutral"]} />
      </ToastIcon>
      <ToastMessage>{entry.title}</ToastMessage>
      <ToastClose
        aria-label="Dismiss notification"
        onClick={() => queue.dismiss(entry.id)}
      >
        <Icon name="close" size="sm" />
      </ToastClose>
      {entry.description && <ToastText>{entry.description}</ToastText>}
      {entry.action && <ToastActions>{entry.action}</ToastActions>}
      {Number.isFinite(lifetime) && lifetime > 0 && (
        <ToastProgress value={progress} />
      )}
    </ToastRoot>
  );
}
