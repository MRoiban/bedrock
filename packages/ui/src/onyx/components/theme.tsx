/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { Slot } from '@radix-ui/react-slot';
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementRef,
  forwardRef,
} from 'react';

import { cn } from '../lib/cn';
import {
  createOnyxThemeStyleMap,
  getOnyxThemeRebindings,
  type OnyxThemeVariables,
} from '../theme/tokens';

export interface OnyxThemeRootProps extends ComponentPropsWithoutRef<'div'> {
  asChild?: boolean;
  themeClass?: string;
  theme?: 'dark' | 'light';
  density?: 'compact' | 'comfortable';
  variables?: OnyxThemeVariables;
}

export const OnyxThemeRoot = forwardRef<ElementRef<'div'>, OnyxThemeRootProps>(
  (
    {
      asChild = false,
      className,
      style,
      themeClass,
      theme,
      density,
      variables,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'div';

    return (
      <Comp
        ref={ref}
        data-slot="theme-root"
        data-theme={theme}
        data-density={density}
        data-onyx-theme-root=""
        data-onyx-rebind={variables ? getOnyxThemeRebindings(variables).join(" ") : undefined}
        data-theme-variant={themeClass ?? undefined}
        className={cn('onyx-theme-root', themeClass, className)}
        style={
          {
            ...createOnyxThemeStyleMap(variables),
            ...style,
          } as CSSProperties
        }
        {...props}
      />
    );
  },
);
OnyxThemeRoot.displayName = 'OnyxThemeRoot';
