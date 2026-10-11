/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { Button, type ButtonProps } from './button';
export const fileTriggerVariants = cva('onyx-file-trigger');
export interface FileTriggerProps extends ButtonProps {
  accept?: string;
  multiple?: boolean;
  directory?: boolean;
  name?: string;
  form?: string;
  onFiles?: (files: File[]) => void;
}
export const FileTrigger = React.forwardRef<
  HTMLButtonElement,
  FileTriggerProps
>(
  (
    {
      accept,
      multiple,
      directory,
      name,
      form,
      onFiles,
      className,
      onClick,
      ...props
    },
    ref,
  ) => {
    const input = React.useRef<HTMLInputElement>(null);
    return (
      <>
        <Button
          ref={ref}
          data-slot="file-trigger"
          className={cn(fileTriggerVariants(), className)}
          {...props}
          onClick={(e) => {
            onClick?.(e);
            if (!e.defaultPrevented) input.current?.click();
          }}
        />
        <input
          ref={input}
          data-slot="file-trigger-input"
          type="file"
          hidden
          accept={accept}
          multiple={multiple}
          name={name}
          form={form}
          disabled={props.disabled}
          {...(directory ? { webkitdirectory: '' } : {})}
          onChange={(e) => {
            onFiles?.(Array.from(e.target.files ?? []));
            if (!name) e.target.value = '';
          }}
        />
      </>
    );
  },
);
FileTrigger.displayName = 'FileTrigger';
