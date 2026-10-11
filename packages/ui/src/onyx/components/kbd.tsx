/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';

export const kbdVariants = cva('onyx-kbd');
export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

export const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'kbd';
    return (
      <Comp
        ref={ref}
        data-slot="kbd"
        className={cn(kbdVariants(), className)}
        {...props}
      />
    );
  },
);
Kbd.displayName = 'Kbd';
