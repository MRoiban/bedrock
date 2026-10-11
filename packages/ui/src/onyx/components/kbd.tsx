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

/** Format shortcut strokes for keyboard chips without consulting browser globals. */
export function formatShortcut(key: string, platform: 'mac' | 'windows' | 'linux' = 'mac'): string {
  const symbols: Record<string, string> = platform === 'mac' ? {
    cmdorctrl: '⌘', cmd: '⌘', ctrl: '⌃', shift: '⇧', alt: '⌥',
    backspace: '⌫', delete: '⌦', forwarddelete: '⌦', enter: '↵', escape: '⎋', tab: '⇥', space: '␣',
    leftarrow: '←', arrowleft: '←', rightarrow: '→', arrowright: '→',
    uparrow: '↑', arrowup: '↑', downarrow: '↓', arrowdown: '↓',
  } : { cmdorctrl: 'Ctrl', cmd: platform === 'windows' ? 'Win' : 'Super', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt',
    backspace: 'Backspace', delete: 'Delete', forwarddelete: 'Delete', enter: 'Enter', escape: 'Esc', tab: 'Tab', space: 'Space',
    leftarrow: '←', arrowleft: '←', rightarrow: '→', arrowright: '→', uparrow: '↑', arrowup: '↑', downarrow: '↓', arrowdown: '↓' };
  return key.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split('+');
    const commandDelete = platform === 'mac' && parts.some(part => /^(cmd|cmdorctrl)$/i.test(part));
    return parts.map(part => part.toLowerCase() === 'delete' && commandDelete ? '⌫' :
      symbols[part.toLowerCase()] ?? part.toUpperCase()).join(platform === 'mac' ? '' : '+');
  }).join(' ');
}
