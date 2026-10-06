/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import { Slot } from '@radix-ui/react-slot';
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementRef,
  forwardRef
} from 'react';

import { cn } from '../lib/cn';
import {
  createOnyxThemeStyleMap,
  type OnyxThemeVariables
} from '../theme/tokens';

export interface OnyxThemeRootProps extends ComponentPropsWithoutRef<'div'> {
  asChild?: boolean;
  themeClass?: string;
  variables?: OnyxThemeVariables;
}

export const OnyxThemeRoot = forwardRef<ElementRef<'div'>, OnyxThemeRootProps>(
  ({ asChild = false, className, style, themeClass, variables, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';

    return (
      <Comp
        ref={ref}
        data-slot="theme-root"
        data-onyx-theme-root=""
        data-theme-variant={themeClass ?? undefined}
        className={cn('onyx-theme-root', themeClass, className)}
        style={{
          ...createOnyxThemeStyleMap(variables),
          ...style
        } as CSSProperties}
        {...props}
      />
    );
  }
);
OnyxThemeRoot.displayName = 'OnyxThemeRoot';
