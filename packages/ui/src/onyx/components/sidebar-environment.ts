/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
export interface SidebarEnvironment {
  window?: Window | null;
  document?: Document | null;
  matchMedia?: (query: string) => Pick<MediaQueryList, 'matches'> | null;
}

export interface SidebarGlobalTarget {
  window?: Window;
  document?: Document;
}

export interface SidebarResizeOptions {
  fallbackWidth: number;
  maxWidth: number;
  minWidth: number;
  onWidthChange: (width: number) => void;
  sidebarElement: HTMLElement | null;
  startX: number;
}

export interface SidebarResolvedEnvironment {
  isMobile(query?: string): boolean;
  beginResize(options: SidebarResizeOptions): () => void;
}

const DEFAULT_MOBILE_QUERY = '(max-width: 768px)';

export function createSidebarEnvironment(
  environment: SidebarEnvironment = {},
  globalTarget: SidebarGlobalTarget = globalThis
): SidebarResolvedEnvironment {
  const resolveWindow = (): Window | null => {
    if (environment.window !== undefined) {
      return environment.window;
    }

    return globalTarget.window ?? null;
  };

  const resolveDocument = (): Document | null => {
    if (environment.document !== undefined) {
      return environment.document;
    }

    const windowObject = resolveWindow();
    if (windowObject?.document) {
      return windowObject.document;
    }

    return globalTarget.document ?? null;
  };

  const readElementWidth = (element: HTMLElement | null, fallbackWidth: number): number =>
    element?.getBoundingClientRect().width ?? fallbackWidth;

  return {
    isMobile(query = DEFAULT_MOBILE_QUERY) {
      const matchMedia =
        environment.matchMedia ??
        resolveWindow()?.matchMedia?.bind(resolveWindow());

      return Boolean(matchMedia?.(query)?.matches);
    },
    beginResize({
      fallbackWidth,
      maxWidth,
      minWidth,
      onWidthChange,
      sidebarElement,
      startX
    }) {
      const windowObject = resolveWindow();
      const documentObject = resolveDocument();
      const body = documentObject?.body;
      if (!windowObject || !body) {
        return () => undefined;
      }

      const startWidth = readElementWidth(sidebarElement, fallbackWidth);
      const previousBodyCursor = body.style.cursor;
      const previousBodyUserSelect = body.style.userSelect;
      let released = false;

      const cleanup = (): void => {
        if (released) {
          return;
        }

        released = true;
        windowObject.removeEventListener('pointermove', onMove);
        windowObject.removeEventListener('pointerup', onUp);
        windowObject.removeEventListener('pointercancel', onUp);
        body.style.cursor = previousBodyCursor;
        body.style.userSelect = previousBodyUserSelect;
      };

      const onMove = (moveEvent: PointerEvent): void => {
        const rawWidth = startWidth + (moveEvent.clientX - startX);
        const nextWidth = Math.max(minWidth, Math.min(Math.round(rawWidth), maxWidth));
        onWidthChange(nextWidth);
      };

      const onUp = (): void => {
        cleanup();
      };

      body.style.cursor = 'col-resize';
      body.style.userSelect = 'none';
      windowObject.addEventListener('pointermove', onMove);
      windowObject.addEventListener('pointerup', onUp);
      windowObject.addEventListener('pointercancel', onUp);

      return cleanup;
    }
  };
}

export const browserSidebarEnvironment = createSidebarEnvironment();
