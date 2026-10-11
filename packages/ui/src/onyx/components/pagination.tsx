/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { useControllableState } from "../lib/use-controllable-state";
import { Icon } from "./icon";
export type PaginationEntry = number | "ellipsis-start" | "ellipsis-end";
export function getPaginationRange(
  page: number,
  totalPages: number,
  siblingCount = 1,
  boundaryCount = 1,
): PaginationEntry[] {
  const total = Number.isFinite(totalPages)
    ? Math.max(0, Math.floor(totalPages))
    : 0;
  if (!total) return [];
  const current = Math.max(
    1,
    Math.min(total, Number.isFinite(page) ? Math.floor(page) : 1),
  );
  const siblings = Math.max(
      0,
      Number.isFinite(siblingCount) ? Math.floor(siblingCount) : 1,
    ),
    boundaries = Math.max(
      1,
      Number.isFinite(boundaryCount) ? Math.floor(boundaryCount) : 1,
    );
  const pages = new Set<number>();
  for (let value = 1; value <= Math.min(total, boundaries); value++)
    pages.add(value);
  for (let value = Math.max(1, total - boundaries + 1); value <= total; value++)
    pages.add(value);
  for (
    let value = Math.max(1, current - siblings);
    value <= Math.min(total, current + siblings);
    value++
  )
    pages.add(value);
  const result: PaginationEntry[] = [];
  let last = 0;
  [...pages]
    .sort((a, b) => a - b)
    .forEach((value) => {
      if (value - last === 2) result.push(last + 1);
      else if (value - last > 2)
        result.push(value < current ? "ellipsis-start" : "ellipsis-end");
      result.push(value);
      last = value;
    });
  return result;
}
export const paginationVariants = cva("onyx-pagination");
export function usePagination({
  page,
  defaultPage = 1,
  totalPages,
  onPageChange,
  siblingCount,
  boundaryCount,
}: {
  page?: number | undefined;
  defaultPage?: number | undefined;
  totalPages: number;
  onPageChange?: ((page: number) => void) | undefined;
  siblingCount?: number | undefined;
  boundaryCount?: number | undefined;
}) {
  const total = Number.isFinite(totalPages)
    ? Math.max(0, Math.floor(totalPages))
    : 0;
  const normalize = (next: number) => Math.min(
    Math.max(1, total), Math.max(1, Number.isFinite(next) ? Math.floor(next) : 1),
  );
  const [value, setValue] = useControllableState({
    value: page === undefined ? undefined : normalize(page),
    defaultValue: normalize(defaultPage),
    onChange: onPageChange,
  });
  const current = normalize(value);
  const setPage = (next: number) => {
    if (total) setValue(normalize(next));
  };
  return {
    page: current,
    totalPages: total,
    pages: getPaginationRange(current, total, siblingCount, boundaryCount),
    setPage,
    previous: () => setPage(current - 1),
    next: () => setPage(current + 1),
    canPrevious: current > 1 && total > 0,
    canNext: current < total,
  };
}
export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  page?: number;
  defaultPage?: number;
  totalPages: number;
  onPageChange?: (page: number) => void;
  siblingCount?: number;
  boundaryCount?: number;
  asChild?: boolean;
  renderPage?: (page: number, current: boolean) => React.ReactNode;
}
export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  (
    {
      page,
      defaultPage,
      totalPages,
      onPageChange,
      siblingCount,
      boundaryCount,
      asChild,
      className,
      renderPage,
      children,
      ...props
    },
    ref,
  ) => {
    const model = usePagination({
      page,
      defaultPage,
      totalPages,
      onPageChange,
      siblingCount,
      boundaryCount,
    });
    const Component = asChild ? Slot : "nav";
    return (
      <Component
        ref={ref}
        data-slot="pagination"
        aria-label="Pages"
        className={cn(paginationVariants(), className)}
        {...props}
      >
        {children ?? (
          <>
            <PaginationButton
              aria-label="Previous page"
              disabled={!model.canPrevious}
              onClick={model.previous}
            >
              <Icon name="chevron-left" />
            </PaginationButton>
            {model.pages.map((entry) =>
              typeof entry === "number" ? (
                <PaginationButton
                  key={entry}
                  aria-label={`Page ${entry}`}
                  aria-current={entry === model.page ? "page" : undefined}
                  data-state={entry === model.page ? "active" : "idle"}
                  onClick={() => model.setPage(entry)}
                >
                  {renderPage?.(entry, entry === model.page) ?? entry}
                </PaginationButton>
              ) : (
                <span
                  key={entry}
                  data-slot="pagination-ellipsis"
                  aria-hidden="true"
                >
                  …
                </span>
              ),
            )}
            <PaginationButton
              aria-label="Next page"
              disabled={!model.canNext}
              onClick={model.next}
            >
              <Icon name="chevron-right" />
            </PaginationButton>
          </>
        )}
      </Component>
    );
  },
);
export const PaginationButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean | undefined }
>(({ className, asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      ref={ref}
      type="button"
      data-slot="pagination-button"
      className={cn("onyx-pagination-button", className)}
      {...props}
    />
  );
});
Pagination.displayName = "Pagination";
PaginationButton.displayName = "PaginationButton";
