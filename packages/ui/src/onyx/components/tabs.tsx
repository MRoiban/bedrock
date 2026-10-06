/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { Button } from './button';
import { cn } from '../lib/cn';

interface TabsContextValue {
  value: string | null;
  setValue: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs parts must be used within <Tabs>.');
  }
  return context;
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export const tabTriggerVariants = cva(
  'inline-flex min-h-9 items-center gap-2 rounded-t-[var(--onyx-radius-md)] border border-b-0 border-transparent px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onyx-control-focus-ring)]',
  {
    variants: {
      active: {
        true: 'border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-surface-panel)] text-[var(--onyx-text-foreground)]',
        false:
          'text-[var(--onyx-text-description)] hover:bg-[var(--onyx-state-hover)] hover:text-[var(--onyx-text-foreground)]'
      }
    },
    defaultVariants: {
      active: false
    }
  }
);

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ children, className, defaultValue, onValueChange, value: valueProp, ...props }, ref) => {
    const [uncontrolledValue, setUncontrolledValue] = React.useState<string | null>(
      defaultValue ?? null
    );
    const value = valueProp ?? uncontrolledValue;

    const setValue = React.useCallback(
      (nextValue: string) => {
        if (valueProp === undefined) {
          setUncontrolledValue(nextValue);
        }
        onValueChange?.(nextValue);
      },
      [onValueChange, valueProp]
    );

    return (
      <TabsContext.Provider value={{ value, setValue }}>
        <div
          ref={ref}
          data-slot="tabs"
          className={cn('flex min-h-0 flex-col', className)}
          {...props}
        >
          {children}
        </div>
      </TabsContext.Provider>
    );
  }
);
Tabs.displayName = 'Tabs';

export const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="tabs-list"
      role="tablist"
      className={cn(
        'flex items-end gap-1 border-b border-[var(--onyx-shell-tabs-border)] bg-[var(--onyx-shell-tabs-bg)] px-2 pt-2',
        className
      )}
      {...props}
    />
  )
);
TabsList.displayName = 'TabsList';

export interface TabsTriggerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'value'>,
    VariantProps<typeof tabTriggerVariants> {
  value: string;
  disabled?: boolean;
}

export const TabsTrigger = React.forwardRef<HTMLDivElement, TabsTriggerProps>(
  ({ className, children, disabled = false, onClick, onKeyDown, value, ...props }, ref) => {
    const context = useTabsContext();
    const active = context.value === value;

    const selectTab = React.useCallback(() => {
      if (!disabled) {
        context.setValue(value);
      }
    }, [context, disabled, value]);

    return (
      <div
        ref={ref}
        data-slot="tabs-trigger"
        data-state={active ? 'active' : 'inactive'}
        role="tab"
        aria-selected={active}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        className={cn(
          tabTriggerVariants({ active }),
          disabled && 'pointer-events-none opacity-50',
          className
        )}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            selectTab();
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) {
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectTab();
          }
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TabsTrigger.displayName = 'TabsTrigger';

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, hidden, ...props }, ref) => {
    const context = useTabsContext();
    const active = context.value === value;

    return (
      <div
        ref={ref}
        data-slot="tabs-content"
        data-state={active ? 'active' : 'inactive'}
        role="tabpanel"
        hidden={hidden ?? !active}
        className={cn('min-h-0 flex-1', className)}
        {...props}
      />
    );
  }
);
TabsContent.displayName = 'TabsContent';

export const TabClose = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, onClick, type = 'button', ...props }, ref) => (
    <Button
      ref={ref}
      data-slot="tab-close"
      variant="ghost"
      size="icon"
      type={type}
      className={cn('h-6 w-6 text-[var(--onyx-text-description)] hover:text-[var(--onyx-text-foreground)]', className)}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      {...props}
    />
  )
);
TabClose.displayName = 'TabClose';

export const TabBadge = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      data-slot="tab-badge"
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--onyx-shell-badge-bg)] px-1.5 text-[10px] font-semibold text-[var(--onyx-shell-badge-fg)]',
        className
      )}
      {...props}
    />
  )
);
TabBadge.displayName = 'TabBadge';

export const TabList = TabsList;
export const Tab = TabsTrigger;
