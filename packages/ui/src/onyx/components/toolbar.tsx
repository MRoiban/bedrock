/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { Button, type ButtonProps } from './button';
import { cn } from '../lib/cn';
import { Slot } from '@radix-ui/react-slot';
import { useRovingFocus } from '../lib/use-roving-focus';
import { useComposedRefs } from '../lib/compose-refs';

export const toolbarButtonVariants = cva('', {
  variants: {
    tone: {
      default: '',
      active:
        'bg-[var(--onyx-state-selected)] text-[var(--onyx-state-selected-fg)] hover:bg-[var(--onyx-state-selected)]',
      subtle:
        'text-[var(--onyx-text-muted)] hover:text-[var(--onyx-text-foreground)] hover:bg-[var(--onyx-state-hover)]',
    },
  },
  defaultVariants: {
    tone: 'default',
  },
});

export const toolbarVariants = cva(
  'onyx-toolbar flex items-center gap-[var(--onyx-space-2)] border-b border-[var(--onyx-shell-toolbar-border)] bg-[var(--onyx-shell-toolbar-bg)] px-[var(--onyx-space-3)] py-[var(--onyx-space-2)]',
);
export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  orientation?: 'horizontal' | 'vertical';
  loop?: boolean;
}
export const Toolbar = React.forwardRef<HTMLDivElement, ToolbarProps>(
  (
    {
      asChild = false,
      className,
      orientation = 'horizontal',
      loop = true,
      onKeyDown,
      onFocusCapture,
      dir,
      ...props
    },
    ref,
  ) => {
    const roving = useRovingFocus({
      orientation,
      loop,
      dir: dir === 'rtl' ? 'rtl' : 'ltr',
    });
    const composed = useComposedRefs(ref, roving.ref);
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={composed}
        data-slot="toolbar"
        data-orientation={orientation}
        role="toolbar"
        aria-orientation={orientation}
        dir={dir}
        className={cn(
          toolbarVariants(),
          orientation === 'vertical' && 'flex-col',
          className,
        )}
        {...props}
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented) roving.onKeyDown(event);
        }}
        onFocusCapture={(event: React.FocusEvent<HTMLDivElement>) => {
          onFocusCapture?.(event);
          if (!event.defaultPrevented) roving.onFocusCapture(event);
        }}
      />
    );
  },
);
Toolbar.displayName = 'Toolbar';

export const toolbarGroupVariants = cva(
  'flex items-center gap-[var(--onyx-space-1)]',
);
export interface ToolbarGroupProps
  extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}
export const ToolbarGroup = React.forwardRef<HTMLDivElement, ToolbarGroupProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        data-slot="toolbar-group"
        className={cn(toolbarGroupVariants(), className)}
        {...props}
      />
    );
  },
);
ToolbarGroup.displayName = 'ToolbarGroup';

export interface ToolbarButtonProps
  extends Omit<ButtonProps, 'variant'>,
    VariantProps<typeof toolbarButtonVariants> {}

export const ToolbarButton = React.forwardRef<
  HTMLButtonElement,
  ToolbarButtonProps
>(({ className, size, tone, ...props }, ref) => (
  <Button
    ref={ref}
    data-slot="toolbar-button"
    data-tone={tone ?? 'default'}
    variant="ghost"
    size={size ?? 'sm'}
    className={cn(toolbarButtonVariants({ tone }), className)}
    {...props}
  />
));
ToolbarButton.displayName = 'ToolbarButton';

export const toolbarSeparatorVariants = cva(
  'mx-[var(--onyx-space-1)] h-[var(--onyx-space-5)] w-px bg-[var(--onyx-shell-toolbar-border)]',
);
export interface ToolbarSeparatorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}
export const ToolbarSeparator = React.forwardRef<
  HTMLDivElement,
  ToolbarSeparatorProps
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      ref={ref}
      data-slot="toolbar-separator"
      role="separator"
      className={cn(toolbarSeparatorVariants(), className)}
      {...props}
    />
  );
});
ToolbarSeparator.displayName = 'ToolbarSeparator';
