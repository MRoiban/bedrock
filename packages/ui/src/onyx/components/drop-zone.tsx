/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn';
export const dropZoneVariants = cva('onyx-drop-zone');
export function acceptsFile(
  file: Pick<File, 'name' | 'type'>,
  accept?: string,
) {
  if (!accept) return true;
  return accept
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) =>
      rule.startsWith('.')
        ? file.name.toLowerCase().endsWith(rule)
        : rule.endsWith('/*')
          ? file.type.toLowerCase().startsWith(rule.slice(0, -1))
          : file.type.toLowerCase() === rule,
    );
}
export interface UseDropZoneOptions {
  accept?: string | undefined;
  multiple?: boolean | undefined;
  disabled?: boolean | undefined;
  maxSize?: number | undefined;
  onFiles?: ((files: File[]) => void) | undefined;
  onReject?: ((files: File[]) => void) | undefined;
}
export function useDropZone({
  accept,
  multiple = true,
  disabled,
  maxSize = Infinity,
  onFiles,
  onReject,
}: UseDropZoneOptions = {}) {
  const [isDropTarget, setTarget] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const depth = React.useRef(0);
  function receive(files: File[]) {
    if (disabled) return false;
    const rejected = files.filter(
      (file) => !acceptsFile(file, accept) || file.size > maxSize,
    );
    if (!multiple && files.length > 1)
      rejected.push(...files.filter((file) => !rejected.includes(file)));
    setInvalid(rejected.length > 0);
    if (rejected.length) onReject?.(rejected);
    else if (files.length) onFiles?.(files);
    return rejected.length === 0 && files.length > 0;
  }
  const dragProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (disabled || !Array.from(e.dataTransfer.types).includes('Files'))
        return;
      e.preventDefault();
      depth.current++;
      setTarget(true);
      const items = Array.from(e.dataTransfer.items ?? []);
      if (items.length)
        setInvalid(
          items.some(
            (item) =>
              item.kind === 'file' &&
              accept &&
              !accept.split(',').some((x) => x.trim().startsWith('.')) &&
              !acceptsFile({ name: '', type: item.type }, accept),
          ),
        );
    },
    onDragOver: (e: React.DragEvent) => {
      if (!disabled) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      if (--depth.current <= 0) {
        depth.current = 0;
        setTarget(false);
        setInvalid(false);
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      depth.current = 0;
      setTarget(false);
      receive(Array.from(e.dataTransfer.files));
    },
  };
  return { isDropTarget, invalid, receive, dragProps };
}
export interface DropZoneProps
  extends React.ComponentPropsWithoutRef<'div'>, UseDropZoneOptions {
  asChild?: boolean;
  directory?: boolean;
  name?: string;
  form?: string;
  invalid?: boolean;
}
export const DropZone = React.forwardRef<HTMLDivElement, DropZoneProps>(
  (
    {
      asChild,
      accept,
      multiple = true,
      disabled,
      maxSize,
      onFiles,
      onReject,
      directory,
      name,
      form,
      invalid,
      className,
      children,
      onKeyDown,
      onClick,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      ...props
    },
    ref,
  ) => {
    const state = useDropZone({
      accept,
      multiple,
      disabled,
      maxSize,
      onFiles,
      onReject,
    });
    const input = React.useRef<HTMLInputElement>(null);
    const Comp = asChild ? Slot : 'div';
    const open = () => {
      if (!disabled) input.current?.click();
    };
    return (
      <>
        <Comp
          ref={ref}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          data-slot="drop-zone"
          data-drop-target={state.isDropTarget ? '' : undefined}
          data-invalid={(invalid ?? state.invalid) ? '' : undefined}
          data-disabled={disabled ? '' : undefined}
          data-state={
            state.isDropTarget ? 'over' : state.invalid ? 'invalid' : 'idle'
          }
          className={cn(dropZoneVariants(), className)}
          {...props}
          onClick={(e: React.MouseEvent<HTMLDivElement>) => {
            onClick?.(e);
            if (!e.defaultPrevented) open();
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
            onKeyDown?.(e);
            if (!e.defaultPrevented && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              open();
            }
          }}
          onDragEnter={(e: React.DragEvent<HTMLDivElement>) => {
            onDragEnter?.(e);
            if (!e.defaultPrevented) state.dragProps.onDragEnter(e);
          }}
          onDragOver={(e: React.DragEvent<HTMLDivElement>) => {
            onDragOver?.(e);
            if (!e.defaultPrevented) state.dragProps.onDragOver(e);
          }}
          onDragLeave={(e: React.DragEvent<HTMLDivElement>) => {
            onDragLeave?.(e);
            if (!e.defaultPrevented) state.dragProps.onDragLeave(e);
          }}
          onDrop={(e: React.DragEvent<HTMLDivElement>) => {
            onDrop?.(e);
            if (!e.defaultPrevented) state.dragProps.onDrop(e);
          }}
        >
          {children}
        </Comp>
        <input
          ref={input}
          data-slot="drop-zone-input"
          type="file"
          hidden
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          name={name}
          form={form}
          {...(directory ? { webkitdirectory: '' } : {})}
          onChange={(e) => {
            const accepted = state.receive(Array.from(e.target.files ?? []));
            if (!name || !accepted) e.target.value = '';
          }}
        />
      </>
    );
  },
);
DropZone.displayName = 'DropZone';
