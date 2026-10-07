export interface Browser {
  window: Window & typeof globalThis;
  document: Document;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now: () => number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}
export function browserEnvironment(): Browser | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const storage = {
    getItem: (key: string) => window.sessionStorage.getItem(key),
    setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
    removeItem: (key: string) => window.sessionStorage.removeItem(key),
  };
  return { window, document, storage, now: Date.now, setTimeout, clearTimeout };
}
