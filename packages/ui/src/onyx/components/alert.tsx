/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { displayToneClasses, type DisplayTone } from "./badge";
export const alertVariants = cva("onyx-alert onyx-display-tone", {
  variants: { tone: displayToneClasses, variant: { inline: "onyx-alert--variant-inline", banner: "onyx-alert--variant-banner" } },
  defaultVariants: { variant: "inline", tone: "info" },
});
export const alertTitleVariants = cva("onyx-alert-title");
export const alertDescriptionVariants = cva("onyx-alert-description");
export const alertActionsVariants = cva("onyx-alert-actions");
export const toneIcons: Record<DisplayTone, string> = {
  neutral: "info",
  info: "info",
  success: "pass",
  warning: "warning",
  danger: "error",
};
export interface AlertProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  asChild?: boolean;
  tone?: DisplayTone;
  variant?: "inline" | "banner";
  urgency?: "polite" | "assertive";
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  dismissLabel?: string;
}
export function useAlert(onDismiss?: () => void) {
  const [dismissed, setDismissed] = React.useState(false);
  return {
    dismissed,
    dismiss: () => {
      setDismissed(true);
      onDismiss?.();
    },
  };
}
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      asChild,
      tone = "info",
      variant = "inline",
      urgency,
      icon,
      title,
      description,
      actions,
      dismissible,
      onDismiss,
      dismissLabel = "Dismiss alert",
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const { dismissed, dismiss } = useAlert(onDismiss);
    if (dismissed) return null;
    const Comp = asChild ? Slot : "div";
    const assertive = urgency
      ? urgency === "assertive"
      : tone === "danger" || tone === "warning";
    return (
      <Comp
        ref={ref}
        role={assertive ? "alert" : "status"}
        data-slot="alert"
        data-tone={tone}
        data-variant={variant}
        data-state="open"
        className={cn(alertVariants({ tone, variant }), className)}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            <span data-slot="alert-icon" className="onyx-alert-icon">
              {icon === undefined ? <Icon name={toneIcons[tone]} /> : icon}
            </span>
            {title && <AlertTitle>{title}</AlertTitle>}
            {description && <AlertDescription>{description}</AlertDescription>}
            {children}
            {(actions || dismissible) && (
              <AlertActions>
                {actions}
                {dismissible && (
                  <button
                    data-slot="alert-close"
                    aria-label={dismissLabel}
                    type="button"
                    onClick={dismiss}
                  >
                    <Icon name="close" size="sm" />
                  </button>
                )}
              </AlertActions>
            )}
          </>
        )}
      </Comp>
    );
  },
);
Alert.displayName = "Alert";
export const AlertTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="alert-title"
      className={cn(alertTitleVariants(), className)}
      {...props}
    />
  );
});
export const AlertDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="alert-description"
      className={cn(alertDescriptionVariants(), className)}
      {...props}
    />
  );
});
export const AlertActions = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      data-slot="alert-actions"
      className={cn(alertActionsVariants(), className)}
      {...props}
    />
  );
});
AlertTitle.displayName = "AlertTitle";
AlertDescription.displayName = "AlertDescription";
AlertActions.displayName = "AlertActions";
