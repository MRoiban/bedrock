/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';

import { cn } from '../lib/cn';
import { Icon } from './icon';

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuPortal = ContextMenuPrimitive.Portal;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

export const ContextMenuSubTrigger = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    data-slot="context-menu-sub-trigger"
    className={cn(
      'group flex min-h-[max(24px,calc(30px*var(--onyx-scale-ui)))] cursor-default select-none items-center rounded-[calc(4px*var(--onyx-scale-ui))] px-[calc(12px*var(--onyx-scale-ui))] py-[calc(5px*var(--onyx-scale-ui))] text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-text-foreground)] outline-none transition-colors focus:bg-[var(--onyx-state-selected)] focus:text-[var(--onyx-state-selected-fg)] data-[state=open]:bg-[var(--onyx-state-selected)] data-[state=open]:text-[var(--onyx-state-selected-fg)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
      inset && 'pl-[calc(32px*var(--onyx-scale-ui))]',
      className
    )}
    {...props}
  >
    {children}
    <Icon
      name="chevron-right"
      size="sm"
      className="ml-[calc(24px*var(--onyx-scale-ui))] text-[var(--onyx-text-muted)] group-focus:text-[var(--onyx-state-selected-fg)] group-data-[state=open]:text-[var(--onyx-state-selected-fg)]"
    />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

export const ContextMenuSubContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent
      ref={ref}
      data-slot="context-menu-sub-content"
      className={cn(
        'z-[var(--onyx-z-popover)] min-w-[calc(252px*var(--onyx-scale-ui))] max-w-[calc(100vw-16px)] max-h-[var(--radix-context-menu-content-available-height,85vh)] overflow-y-auto rounded-[calc(6px*var(--onyx-scale-ui))] border border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-surface-menu)] p-[calc(4px*var(--onyx-scale-ui))] text-[var(--onyx-text-foreground)] shadow-[var(--onyx-shadow-md)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

export const ContextMenuContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      data-slot="context-menu-content"
      className={cn(
        'z-[var(--onyx-z-popover)] min-w-[calc(252px*var(--onyx-scale-ui))] max-w-[calc(100vw-16px)] max-h-[var(--radix-context-menu-content-available-height,85vh)] overflow-y-auto rounded-[calc(6px*var(--onyx-scale-ui))] border border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-surface-menu)] p-[calc(4px*var(--onyx-scale-ui))] text-[var(--onyx-text-foreground)] shadow-[var(--onyx-shadow-md)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

export const ContextMenuItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    data-slot="context-menu-item"
    className={cn(
      'group relative flex min-h-[max(24px,calc(30px*var(--onyx-scale-ui)))] cursor-default select-none items-center gap-[calc(0px*var(--onyx-scale-ui))] rounded-[calc(4px*var(--onyx-scale-ui))] px-[calc(12px*var(--onyx-scale-ui))] py-[calc(5px*var(--onyx-scale-ui))] text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-text-foreground)] outline-none transition-colors focus:bg-[var(--onyx-state-selected)] focus:text-[var(--onyx-state-selected-fg)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
      inset && 'pl-[calc(32px*var(--onyx-scale-ui))]',
      className
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

export const ContextMenuCheckboxItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ checked, children, className, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    data-slot="context-menu-checkbox-item"
    {...(checked === undefined ? {} : { checked })}
    className={cn(
      'group relative flex min-h-[max(24px,calc(30px*var(--onyx-scale-ui)))] cursor-default select-none items-center rounded-[calc(var(--onyx-radius-sm)*var(--onyx-scale-ui))] py-[calc(6px*var(--onyx-scale-ui))] pl-[calc(32px*var(--onyx-scale-ui))] pr-[calc(8px*var(--onyx-scale-ui))] text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-text-foreground)] outline-none transition-colors focus:bg-[var(--onyx-state-selected)] focus:text-[var(--onyx-state-selected-fg)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
      className
    )}
    {...props}
  >
    <span className="absolute left-[calc(8px*var(--onyx-scale-ui))] flex h-[calc(14px*var(--onyx-scale-ui))] w-[calc(14px*var(--onyx-scale-ui))] items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Icon name="check" size="sm" className="text-[var(--onyx-state-selected-fg)]" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName;

export const ContextMenuRadioItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    data-slot="context-menu-radio-item"
    className={cn(
      'group relative flex min-h-[max(24px,calc(30px*var(--onyx-scale-ui)))] cursor-default select-none items-center rounded-[calc(var(--onyx-radius-sm)*var(--onyx-scale-ui))] py-[calc(6px*var(--onyx-scale-ui))] pl-[calc(32px*var(--onyx-scale-ui))] pr-[calc(8px*var(--onyx-scale-ui))] text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-text-foreground)] outline-none transition-colors focus:bg-[var(--onyx-state-selected)] focus:text-[var(--onyx-state-selected-fg)] data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
      className
    )}
    {...props}
  >
    <span className="absolute left-[calc(8px*var(--onyx-scale-ui))] flex h-[calc(14px*var(--onyx-scale-ui))] w-[calc(14px*var(--onyx-scale-ui))] items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Icon name="primitive-dot" size="sm" className="text-[var(--onyx-state-selected-fg)]" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

export const ContextMenuLabel = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    data-slot="context-menu-label"
    className={cn(
      'px-[calc(12px*var(--onyx-scale-ui))] pb-[calc(4px*var(--onyx-scale-ui))] pt-[calc(8px*var(--onyx-scale-ui))] text-[length:calc(12px*var(--onyx-scale-ui))] leading-[1.333333] font-semibold text-[var(--onyx-text-description)]',
      inset && 'pl-[calc(32px*var(--onyx-scale-ui))]',
      className
    )}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

export const ContextMenuSeparator = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    data-slot="context-menu-separator"
    className={cn('mx-[calc(12px*var(--onyx-scale-ui))] my-[calc(4px*var(--onyx-scale-ui))] h-px bg-[var(--onyx-shell-tabs-border)]', className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

export const ContextMenuShortcut = ({
  className,
  ...props
}: ComponentPropsWithoutRef<'span'>) => (
  <span
    data-slot="context-menu-shortcut"
    className={cn('ml-auto text-[length:calc(12px*var(--onyx-scale-ui))] leading-[1.333333] text-[var(--onyx-text-description)]', className)}
    {...props}
  />
);
ContextMenuShortcut.displayName = 'ContextMenuShortcut';
