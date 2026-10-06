/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';

import { cn } from '../lib/cn';
import { Icon } from './icon';

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    data-slot="select-trigger"
    className={cn(
      'flex h-[max(28px,calc(36px*var(--onyx-scale-ui)))] w-full items-center justify-between gap-[calc(8px*var(--onyx-scale-ui))] rounded-[calc(var(--onyx-radius-md)*var(--onyx-scale-ui))] border border-[var(--onyx-control-input-border)] bg-[var(--onyx-control-input-bg)] px-[calc(12px*var(--onyx-scale-ui))] py-[calc(8px*var(--onyx-scale-ui))] text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-control-input-fg)] shadow-[var(--onyx-shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onyx-control-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <Icon name="chevron-down" size="sm" className="text-[var(--onyx-text-muted)]" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      data-slot="select-content"
      className={cn(
        'z-[var(--onyx-z-popover)] min-w-[calc(128px*var(--onyx-scale-ui))] max-w-[calc(100vw-16px)] max-h-[var(--radix-select-content-available-height,85vh)] overflow-y-auto rounded-[calc(var(--onyx-radius-md)*var(--onyx-scale-ui))] border border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-surface-menu)] text-[var(--onyx-text-foreground)] shadow-[var(--onyx-shadow-md)] focus:outline-none',
        position === 'popper' && 'translate-y-[calc(4px*var(--onyx-scale-ui))]',
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        data-slot="select-viewport"
        className={cn(
          'p-[calc(4px*var(--onyx-scale-ui))]',
          position === 'popper' &&
            'max-h-[var(--radix-select-content-available-height)] w-full min-w-[var(--radix-select-trigger-width)] overflow-y-auto'
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    data-slot="select-label"
    className={cn(
      'py-[calc(6px*var(--onyx-scale-ui))] pl-[calc(32px*var(--onyx-scale-ui))] pr-[calc(8px*var(--onyx-scale-ui))] text-[length:calc(12px*var(--onyx-scale-ui))] leading-[1.333333] font-semibold text-[var(--onyx-text-description)]',
      className
    )}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
    leading?: React.ReactNode;
    trailing?: React.ReactNode;
  }
>(({ className, children, leading, trailing, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    data-slot="select-item"
    className={cn(
      'relative flex min-h-[max(24px,calc(32px*var(--onyx-scale-ui)))] w-full cursor-default select-none items-center rounded-[calc(var(--onyx-radius-sm)*var(--onyx-scale-ui))] py-[calc(6px*var(--onyx-scale-ui))] pl-[calc(32px*var(--onyx-scale-ui))] pr-[calc(8px*var(--onyx-scale-ui))] text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-text-foreground)] outline-none transition-colors focus:bg-[var(--onyx-state-selected)] focus:text-[var(--onyx-state-selected-fg)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
      className
    )}
    {...props}
  >
    <span className="absolute left-[calc(8px*var(--onyx-scale-ui))] flex h-[calc(14px*var(--onyx-scale-ui))] w-[calc(14px*var(--onyx-scale-ui))] items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Icon name="check" size="sm" className="text-[var(--onyx-state-selected-fg)]" />
      </SelectPrimitive.ItemIndicator>
    </span>
    {leading ? (
      <span data-slot="select-item-leading" className="flex h-[calc(16px*var(--onyx-scale-ui))] w-[calc(16px*var(--onyx-scale-ui))] shrink-0 items-center justify-center">
        {leading}
      </span>
    ) : null}
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    {trailing ? (
      <span data-slot="select-item-trailing" className="ml-auto flex shrink-0 items-center">
        {trailing}
      </span>
    ) : null}
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    data-slot="select-separator"
    className={cn('my-[calc(4px*var(--onyx-scale-ui))] h-px bg-[var(--onyx-shell-tabs-border)]', className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator
};
