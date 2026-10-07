export interface Browser {
  window: Window & typeof globalThis;
  document: Document;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
}
export function browserEnvironment(): Browser | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const storage = {
    getItem: (key: string) => window.sessionStorage.getItem(key),
    setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
    removeItem: (key: string) => window.sessionStorage.removeItem(key),
  };
  return {
    window, document, storage, now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: id => globalThis.clearTimeout(id),
  };
}
