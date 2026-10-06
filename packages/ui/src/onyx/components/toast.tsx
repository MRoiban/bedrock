/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from 'react';

import { cn } from '../lib/cn';

export const ToastViewport = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-viewport"
      className={cn('toast-container', className)}
      {...props}
    />
  )
);
ToastViewport.displayName = 'ToastViewport';

export const ToastRoot = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast"
      className={cn('toast', className)}
      {...props}
    />
  )
);
ToastRoot.displayName = 'ToastRoot';

export const ToastContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-content"
      className={cn('toast-content', className)}
      {...props}
    />
  )
);
ToastContent.displayName = 'ToastContent';

export const ToastIcon = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-icon"
      className={cn('toast-icon', className)}
      {...props}
    />
  )
);
ToastIcon.displayName = 'ToastIcon';

export const ToastMessage = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-message"
      className={cn('toast-message', className)}
      {...props}
    />
  )
);
ToastMessage.displayName = 'ToastMessage';

export const ToastSource = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-source"
      className={cn('toast-source', className)}
      {...props}
    />
  )
);
ToastSource.displayName = 'ToastSource';

export const ToastText = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-text"
      className={cn('toast-text', className)}
      {...props}
    />
  )
);
ToastText.displayName = 'ToastText';

export const ToastClose = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      data-slot="toast-close"
      className={cn('toast-close', className)}
      type={type}
      {...props}
    />
  )
);
ToastClose.displayName = 'ToastClose';

export const ToastActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="toast-actions"
      className={cn('toast-actions', className)}
      {...props}
    />
  )
);
ToastActions.displayName = 'ToastActions';

export interface ToastProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
}

export const ToastProgress = React.forwardRef<HTMLDivElement, ToastProgressProps>(
  ({ className, value, ...props }, ref) => {
    const normalizedValue = Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : 0;

    return (
      <div
        ref={ref}
        data-slot="toast-progress"
        className={cn('toast-progress', className)}
        {...props}
      >
        <div
          data-slot="toast-progress-bar"
          className="toast-progress-bar"
          style={{ width: `${normalizedValue}%` }}
        />
      </div>
    );
  }
);
ToastProgress.displayName = 'ToastProgress';
