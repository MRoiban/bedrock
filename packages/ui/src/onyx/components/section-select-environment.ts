/* Vendored from Onyx. Do not edit; run bun run sync:onyx. */
const OPEN_BODY_CLASS = 'onyx-section-select-open';

export interface SectionSelectEnvironment {
  window?: Window | null;
  document?: Document | null;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  getSelection?: () => Selection | null;
}

export interface SectionSelectRect {
  bottom: number;
  left: number;
  width: number;
}

export interface SectionSelectViewport {
  width: number;
  height: number;
}

export interface SectionSelectGlobalTarget {
  window?: Window;
  document?: Document;
}

interface DocumentSelectionLockRecord {
  count: number;
  preventSelection: (event: Event) => void;
  clearSelection: () => void;
}

const documentSelectionLocks = new WeakMap<Document, DocumentSelectionLockRecord>();

export interface SectionSelectResolvedEnvironment {
  resolveWindow(): Window | null;
  resolveDocument(): Document | null;
  readElementRect(element: HTMLElement): SectionSelectRect;
  readViewport(documentObject: Document | null, fallback: SectionSelectViewport): SectionSelectViewport;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  clearAmbientSelection(documentObject?: Document | null): void;
  retainDocumentSelectionLock(documentObject: Document | null): () => void;
  retainOpenInteractionHandlers(options: SectionSelectOpenInteractionOptions): () => void;
}

export interface SectionSelectOpenInteractionOptions {
  documentObject: Document;
  isTargetInside: (target: EventTarget | null) => boolean;
  onEscape: () => void;
  onOutsidePointerDown: () => void;
  onWindowChange: () => void;
  windowObject: Window;
}

export function createSectionSelectEnvironment(
  environment: SectionSelectEnvironment = {},
  globalTarget: SectionSelectGlobalTarget = globalThis
): SectionSelectResolvedEnvironment {
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

  const getSelection = (documentObject?: Document | null): Selection | null =>
    environment.getSelection?.() ??
    resolveWindow()?.getSelection?.() ??
    documentObject?.defaultView?.getSelection?.() ??
    null;

  return {
    resolveWindow,
    resolveDocument,
    readElementRect(element) {
      return element.getBoundingClientRect();
    },
    readViewport(documentObject, fallback) {
      const windowObject = resolveWindow();
      return {
        width:
          windowObject?.innerWidth ??
          documentObject?.documentElement.clientWidth ??
          fallback.width,
        height:
          windowObject?.innerHeight ??
          documentObject?.documentElement.clientHeight ??
          fallback.height
      };
    },
    requestFrame(callback) {
      const windowObject = resolveWindow();
      const scheduleFrame =
        environment.requestAnimationFrame ??
        windowObject?.requestAnimationFrame?.bind(windowObject);

      if (scheduleFrame) {
        return scheduleFrame(callback);
      }

      return setTimeout(() => callback(Date.now()), 0) as unknown as number;
    },
    cancelFrame(handle) {
      const windowObject = resolveWindow();
      const cancel =
        environment.cancelAnimationFrame ??
        windowObject?.cancelAnimationFrame?.bind(windowObject);

      if (cancel) {
        cancel(handle);
        return;
      }

      clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    clearAmbientSelection(documentObject) {
      getSelection(documentObject)?.removeAllRanges();
    },
    retainDocumentSelectionLock(documentObject) {
      if (!documentObject?.body) {
        return () => {};
      }

      let record = documentSelectionLocks.get(documentObject);
      if (!record) {
        record = {
          count: 0,
          preventSelection: (event: Event) => {
            event.preventDefault();
          },
          clearSelection: () => {
            getSelection(documentObject)?.removeAllRanges();
          }
        };
        documentSelectionLocks.set(documentObject, record);
        documentObject.body.classList.add(OPEN_BODY_CLASS);
        documentObject.addEventListener('selectstart', record.preventSelection, true);
        documentObject.addEventListener('dragstart', record.preventSelection, true);
        documentObject.addEventListener('selectionchange', record.clearSelection, true);
      }

      record.count += 1;
      record.clearSelection();
      let released = false;

      return () => {
        if (released) {
          return;
        }

        released = true;
        const currentRecord = documentSelectionLocks.get(documentObject);
        if (!currentRecord) {
          return;
        }

        currentRecord.count = Math.max(0, currentRecord.count - 1);
        if (currentRecord.count === 0) {
          documentObject.removeEventListener('selectstart', currentRecord.preventSelection, true);
          documentObject.removeEventListener('dragstart', currentRecord.preventSelection, true);
          documentObject.removeEventListener('selectionchange', currentRecord.clearSelection, true);
          documentObject.body.classList.remove(OPEN_BODY_CLASS);
          documentSelectionLocks.delete(documentObject);
        }
      };
    },
    retainOpenInteractionHandlers({
      documentObject,
      isTargetInside,
      onEscape,
      onOutsidePointerDown,
      onWindowChange,
      windowObject
    }) {
      const handlePointerDown = (event: PointerEvent): void => {
        if (isTargetInside(event.target)) {
          return;
        }

        onOutsidePointerDown();
      };

      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') {
          return;
        }

        event.preventDefault();
        onEscape();
      };

      documentObject.addEventListener('pointerdown', handlePointerDown, true);
      documentObject.addEventListener('keydown', handleKeyDown, true);
      windowObject.addEventListener('resize', onWindowChange);
      windowObject.addEventListener('scroll', onWindowChange, true);

      return () => {
        documentObject.removeEventListener('pointerdown', handlePointerDown, true);
        documentObject.removeEventListener('keydown', handleKeyDown, true);
        windowObject.removeEventListener('resize', onWindowChange);
        windowObject.removeEventListener('scroll', onWindowChange, true);
      };
    }
  };
}
