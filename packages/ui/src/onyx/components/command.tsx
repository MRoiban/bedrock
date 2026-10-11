/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';

import { cn } from '../lib/cn';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Icon } from './icon';

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    data-slot="command"
    className={cn(
      'flex h-full w-full flex-col overflow-hidden rounded-[calc(var(--onyx-radius-md)*var(--onyx-scale-ui))] bg-[var(--onyx-surface-menu)] text-[var(--onyx-text-foreground)]',
      className
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

interface CommandDialogProps extends React.ComponentProps<typeof Dialog> {
  shouldFilter?: React.ComponentProps<typeof CommandPrimitive>['shouldFilter'];
}

const CommandDialog = ({
  children,
  modal = false,
  shouldFilter,
  ...props
}: CommandDialogProps) => (
  <Dialog modal={modal} {...props}>
    <DialogContent className="overflow-hidden mb-auto mt-[12vh] max-w-[min(calc(640px*var(--onyx-scale-ui)),calc(100vw-48px))] sm:max-w-[min(calc(576px*var(--onyx-scale-ui)),calc(100vw-48px))] border border-[var(--onyx-border-default)] bg-[var(--onyx-surface-dialog)] p-[calc(0px*var(--onyx-scale-ui))] text-[var(--onyx-text-foreground)] shadow-[var(--onyx-shadow-lg)] [&_[cmdk-root]]:outline-none">
      <DialogTitle className="sr-only">Command Palette</DialogTitle>
      <DialogDescription className="sr-only">
        Search for commands and quick actions. Type to filter, Enter to run.
      </DialogDescription>
      <Command className="h-auto rounded-none" {...(shouldFilter === undefined ? {} : { shouldFilter })}>{children}</Command>
    </DialogContent>
  </Dialog>
);

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div data-slot="command-input-shell" className="flex items-center border-b border-[var(--onyx-border-default)] px-[calc(16px*var(--onyx-scale-ui))]">
    <Icon name="search" size="sm" className="text-[var(--onyx-text-description)]" />
    <CommandPrimitive.Input
      ref={ref}
      data-slot="command-input"
      className={cn(
        'flex h-[max(32px,calc(40px*var(--onyx-scale-ui)))] w-full items-center bg-transparent py-[calc(8px*var(--onyx-scale-ui))] pl-[calc(12px*var(--onyx-scale-ui))] text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-text-foreground)] outline-none placeholder:text-[var(--onyx-text-description)]',
        className
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    data-slot="command-list"
    className={cn('max-h-[min(calc(420px*var(--onyx-scale-ui)),60vh,max(0px,calc(85vh-max(32px,calc(40px*var(--onyx-scale-ui)))-3px)))] overflow-y-auto overflow-x-hidden', className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    data-slot="command-empty"
    className={cn('py-[calc(48px*var(--onyx-scale-ui))] text-center text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-text-description)]', className)}
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    data-slot="command-group"
    className={cn(
      'overflow-hidden py-[calc(8px*var(--onyx-scale-ui))] text-[var(--onyx-text-muted)] [&_[cmdk-group-heading]]:px-[calc(16px*var(--onyx-scale-ui))] [&_[cmdk-group-heading]]:text-[length:calc(12px*var(--onyx-scale-ui))] [&_[cmdk-group-heading]]:leading-[1.333333] [&_[cmdk-group-heading]]:font-semibold',
      className
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    data-slot="command-separator"
    className={cn('mx-[calc(8px*var(--onyx-scale-ui))] h-px bg-[var(--onyx-border-default)]', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    data-slot="command-item"
    className={cn(
      'group flex min-h-[max(22px,calc(28px*var(--onyx-scale-ui)))] w-full cursor-default select-none items-center gap-[calc(8px*var(--onyx-scale-ui))] rounded-[calc(var(--onyx-radius-sm)*var(--onyx-scale-ui))] px-[calc(12px*var(--onyx-scale-ui))] py-[calc(4px*var(--onyx-scale-ui))] text-[length:calc(14px*var(--onyx-scale-ui))] leading-[1.428571] text-[var(--onyx-text-foreground)] outline-none transition-colors data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40 aria-selected:bg-[var(--onyx-state-selected)] aria-selected:text-[var(--onyx-state-selected-fg)]',
      className
    )}
    {...props}
  >
    {children}
  </CommandPrimitive.Item>
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    data-slot="command-shortcut"
    className={cn(
      'ml-auto inline-flex shrink-0 items-center gap-[calc(4px*var(--onyx-scale-ui))] whitespace-nowrap text-[length:calc(12px*var(--onyx-scale-ui))] leading-[1.333333] font-medium text-[var(--onyx-text-description)]',
      className
    )}
    {...props}
  />
);
CommandShortcut.displayName = 'CommandShortcut';

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
};
