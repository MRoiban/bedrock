/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactElement,
  type ReactNode,
  type MouseEvent,
  forwardRef,
  cloneElement,
  isValidElement,
  useRef,
  useLayoutEffect,
} from 'react';

import { cn } from '../lib/cn';
import { Spinner } from './spinner';
import { useComposedRefs } from '../lib/compose-refs';

export const buttonVariants = cva(
  'onyx-button inline-flex items-center justify-center whitespace-nowrap aria-pressed:bg-[var(--onyx-state-selected)] aria-pressed:text-[var(--onyx-state-selected-fg)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--onyx-control-button-bg)] text-[var(--onyx-control-button-fg)] hover:bg-[var(--onyx-control-button-hover-bg)]',
        destructive:
          'bg-[var(--onyx-control-destructive-bg)] text-[var(--onyx-control-destructive-fg)] hover:brightness-110',
        secondary:
          'bg-[var(--onyx-control-secondary-bg)] text-[var(--onyx-control-secondary-fg)] hover:bg-[var(--onyx-control-secondary-hover-bg)]',
        outline:
          'border border-[var(--onyx-border-default)] bg-transparent text-[var(--onyx-text-foreground)] hover:bg-[var(--onyx-state-hover)]',
        ghost:
          'bg-transparent text-[var(--onyx-text-foreground)] hover:bg-[var(--onyx-state-hover)]',
        link: 'px-0 text-[var(--onyx-text-link)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[var(--onyx-button-height,var(--onyx-control-height-md))]',
        md: 'h-[var(--onyx-button-height,var(--onyx-control-height-md))]',
        xs: 'relative shrink-0 m-[max(0rem,calc((var(--onyx-space-6)-var(--onyx-control-height-xs))/2))] h-[var(--onyx-control-height-xs)] after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:h-full after:w-full after:min-h-[var(--onyx-space-6)] after:min-w-[var(--onyx-space-6)] after:content-[\'\']',
        sm: 'h-[var(--onyx-control-height-sm)]',
        lg: 'h-[var(--onyx-control-height-lg)]',
        icon: 'h-[var(--onyx-button-height,var(--onyx-control-height-md))] w-[var(--onyx-button-height,var(--onyx-control-height-md))]',
        'icon-sm':
          'h-[var(--onyx-control-height-sm)] w-[var(--onyx-control-height-sm)]',
        'icon-xs':
          'relative shrink-0 m-[max(0rem,calc((var(--onyx-space-6)-var(--onyx-control-height-xs))/2))] h-[var(--onyx-control-height-xs)] w-[var(--onyx-control-height-xs)] after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:h-full after:w-full after:min-h-[var(--onyx-space-6)] after:min-w-[var(--onyx-space-6)] after:content-[\'\']',
        /** The containing workbench surface supplies its compact geometry. */
        native: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ComponentPropsWithoutRef<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  pressed?: boolean;
}

export const Button = forwardRef<ElementRef<'button'>, ButtonProps>(
  (
    {
      asChild = false,
      className,
      size = 'md',
      variant = 'default',
      loading = false,
      pressed,
      children,
      onClick,
      onClickCapture,
      style,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const element = useRef<HTMLButtonElement>(null);
    const width = useRef<number | undefined>(undefined);
    const composedRef = useComposedRefs(ref, element);
    useLayoutEffect(() => {
      if (!loading && element.current) {
        const measured = element.current.getBoundingClientRect().width;
        width.current = measured || undefined;
      }
    });
    const blocked = loading || props.disabled;
    const blockActivation = (event: React.SyntheticEvent) => { event.preventDefault(); event.stopPropagation(); };
    const resolvedPressed = pressed ?? props['aria-pressed'];
    const content = (
      <>
        <span data-slot="button-label" className="onyx-button-label">
          {children}
        </span>
        {loading && (
          <span
            data-slot="button-spinner"
            className="onyx-button-spinner"
            aria-hidden="true"
          >
            <Spinner size="xs" aria-hidden="true" role={undefined} />
          </span>
        )}
      </>
    );
    return (
      <Comp
        ref={composedRef}
        type={asChild ? undefined : 'button'}
        data-slot="button"
        data-size={size === 'default' ? 'md' : size}
        data-variant={variant}
        data-state={
          loading
            ? 'loading'
            : resolvedPressed === true
              ? 'on'
              : resolvedPressed === false
                ? 'off'
                : undefined
        }
        data-loading={loading ? '' : undefined}
        data-disabled={blocked ? '' : undefined}
        aria-disabled={blocked || undefined}
        aria-busy={loading || undefined}
        aria-pressed={resolvedPressed}
        className={cn(buttonVariants({ size, variant }), className)}
        style={{
          ...(loading && width.current ? { width: width.current } : {}),
          ...style,
        }}
        {...props}
        onPointerDownCapture={blocked ? blockActivation : props.onPointerDownCapture}
        onKeyDownCapture={blocked ? blockActivation : props.onKeyDownCapture}
        onClickCapture={(event: MouseEvent<HTMLButtonElement>) => {
          if (loading || props.disabled) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClickCapture?.(event);
        }}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (loading || props.disabled) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
      >
        {asChild && isValidElement(children)
          ? cloneElement(
              children as ReactElement<Record<string, unknown> & { children?: ReactNode | undefined }>,
              blocked ? {
                onClickCapture: blockActivation,
                onClick: blockActivation,
                onPointerDownCapture: blockActivation,
                onPointerDown: blockActivation,
                onKeyDownCapture: blockActivation,
                onKeyDown: blockActivation,
              } : {},
              <>
                <span data-slot="button-label" className="onyx-button-label">
                  {(children.props as { children?: ReactNode | undefined }).children}
                </span>
                {loading && (
                  <span
                    data-slot="button-spinner"
                    className="onyx-button-spinner"
                    aria-hidden="true"
                  >
                    <Spinner size="xs" aria-hidden="true" role={undefined} />
                  </span>
                )}
              </>,
            )
          : content}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
