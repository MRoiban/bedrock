/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { type KeyboardEvent, type ReactNode, forwardRef, useEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn';

/**
 * Zed-style prompt (crates/ui_prompt): a compact, title-less card with a
 * message, an optional muted detail, and full-width stacked actions. The first
 * action starts active; arrows/Tab cycle, Enter picks the active action, and
 * Escape picks the action labelled "Cancel" (or does nothing when there is
 * none, so the prompt cannot be dismissed without an answer).
 */
export interface PromptProps {
  message: string;
  detail?: string | null;
  actions: readonly string[];
  onRespond: (actionIndex: number) => void;
  /** Label Escape resolves to. Defaults to "Cancel". */
  cancelLabel?: string;
  className?: string;
}

export function resolvePromptCancelIndex(actions: readonly string[], cancelLabel = 'Cancel'): number {
  return actions.indexOf(cancelLabel);
}

export function stepPromptActionIndex(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) {
    return 0;
  }
  return (current + direction + count) % count;
}

/** Renders `code` spans and line breaks, the only markdown Zed prompts use. */
export function renderPromptText(text: string): ReactNode[] {
  return text.split('\n').flatMap((line, lineIndex) => {
    const segments = line.split('`').map((segment, segmentIndex) =>
      segmentIndex % 2 === 1 ? (
        <code key={`${lineIndex}-${segmentIndex}`} data-slot="prompt-code">
          {segment}
        </code>
      ) : (
        segment
      )
    );
    return lineIndex === 0 ? segments : [<br key={`br-${lineIndex}`} />, ...segments];
  });
}

export const Prompt = forwardRef<HTMLDivElement, PromptProps>(
  ({ actions, cancelLabel = 'Cancel', className, detail, message, onRespond }, ref) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

    useEffect(() => {
      setActiveIndex(0);
    }, [actions, message]);

    useEffect(() => {
      buttonRefs.current[activeIndex]?.focus();
    }, [activeIndex, actions, message]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      const step = (direction: 1 | -1) => {
        event.preventDefault();
        setActiveIndex((current) => stepPromptActionIndex(current, actions.length, direction));
      };

      switch (event.key) {
        case 'ArrowDown':
          return step(1);
        case 'ArrowUp':
          return step(-1);
        case 'Tab':
          return step(event.shiftKey ? -1 : 1);
        case 'Home':
          event.preventDefault();
          return setActiveIndex(0);
        case 'End':
          event.preventDefault();
          return setActiveIndex(Math.max(0, actions.length - 1));
        case 'Enter':
          event.preventDefault();
          event.stopPropagation();
          return onRespond(activeIndex);
        case 'Escape': {
          event.preventDefault();
          event.stopPropagation();
          const cancelIndex = resolvePromptCancelIndex(actions, cancelLabel);
          if (cancelIndex >= 0) {
            onRespond(cancelIndex);
          }
          return;
        }
        default:
          return;
      }
    };

    return (
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={message}
        data-slot="prompt"
        className={cn(
          'flex w-[calc(var(--onyx-prompt-width)*var(--onyx-scale-ui))] max-w-[calc(100vw-var(--onyx-space-8))] cursor-default flex-col gap-[calc(var(--onyx-space-4)*var(--onyx-scale-ui))] overflow-hidden rounded-[calc(var(--onyx-radius-lg)*var(--onyx-scale-ui))] border border-[var(--onyx-border-default)] bg-[var(--onyx-surface-dialog)] p-[calc(var(--onyx-space-4)*var(--onyx-scale-ui))] text-[var(--onyx-text-foreground)] shadow-[var(--onyx-shadow-lg)]',
          '[&_[data-slot=prompt-code]]:rounded-[calc(var(--onyx-radius-xs)*var(--onyx-scale-ui))] [&_[data-slot=prompt-code]]:bg-[var(--onyx-state-hover)] [&_[data-slot=prompt-code]]:px-[calc(var(--onyx-space-1)*var(--onyx-scale-ui))] [&_[data-slot=prompt-code]]:[font-family:var(--onyx-font-mono)]',
          className
        )}
        onKeyDown={handleKeyDown}
      >
        <p data-slot="prompt-message" className="m-0 break-words">
          {renderPromptText(message)}
        </p>
        {detail ? (
          <p data-slot="prompt-detail" className="m-0 break-words text-[length:calc(var(--onyx-text-sm)*var(--onyx-scale-ui))] leading-[var(--onyx-leading-normal)] text-[var(--onyx-text-description)]">
            {renderPromptText(detail)}
          </p>
        ) : null}
        <div data-slot="prompt-actions" className="flex flex-col gap-[calc(var(--onyx-space-1)*var(--onyx-scale-ui))]">
          {actions.map((action, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={`${index}-${action}`}
                ref={(element) => {
                  buttonRefs.current[index] = element;
                }}
                type="button"
                data-slot="prompt-action"
                data-active={active ? 'true' : undefined}
                tabIndex={active ? 0 : -1}
                className={cn(
                  'flex h-[var(--onyx-control-height-sm)] w-full items-center justify-center rounded-[calc(var(--onyx-radius-sm)*var(--onyx-scale-ui))] border px-[calc(var(--onyx-space-2)*var(--onyx-scale-ui))] text-[length:inherit] leading-none outline-none transition-colors',
                  active
                    ? 'border-[color-mix(in_srgb,var(--onyx-control-focus-ring)_50%,transparent)] bg-[color-mix(in_srgb,var(--onyx-control-focus-ring)_16%,transparent)] text-[var(--onyx-text-foreground)]'
                    : 'border-[var(--onyx-border-default)] bg-transparent text-[var(--onyx-text-foreground)] hover:bg-[var(--onyx-state-hover)]'
                )}
                onClick={() => onRespond(index)}
              >
                {action}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
);
Prompt.displayName = 'Prompt';
