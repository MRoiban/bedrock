import type { Browser } from "./browser";
export class FakeClock {
  time = 100_000;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void; delay: number }>();
  setTimeout = ((fn: () => void, delay = 0) => {
    const id = ++this.next;
    this.timers.set(id, { at: this.time + delay, fn, delay });
    return id;
  }) as unknown as typeof setTimeout;
  clearTimeout = ((id: number) => { this.timers.delete(id); }) as unknown as typeof clearTimeout;
  advance(ms: number) {
    const until = this.time + ms;
    for (;;) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]); next[1].fn();
    }
    this.time = until;
  }
}
export class FakeTarget extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null) {
    if (!fn) return;
    const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set);
    super.addEventListener(type, fn);
  }
  override removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null) {
    if (fn) this.listeners.get(type)?.delete(fn);
    super.removeEventListener(type, fn);
  }
  emit(type: string) { this.dispatchEvent(new Event(type)); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
export class FakeField extends FakeTarget {
  tagName = "INPUT";
  name = "";
  type = "text";
  id = "";
  private text = "";
  private selected = false;
  get value() { return this.text; }
  set value(value: string) { this.text = value; }
  get checked() { return this.selected; }
  set checked(value: boolean) { this.selected = value; }
}
function hostReceiver(receiver: unknown, owner: object, globalCall = false) {
  // Window functions also permit bare global calls; Storage methods do not.
  if (receiver !== owner && !(globalCall && (receiver === undefined || receiver === globalThis))) throw new TypeError("Illegal invocation");
}
export function fakeBrowser(page?: string) {
  const clock = new FakeClock();
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { hostReceiver(this, storage); return values.get(key) ?? null; },
    setItem(key: string, value: string) { hostReceiver(this, storage); values.set(key, value); },
    removeItem(key: string) { hostReceiver(this, storage); values.delete(key); },
  };
  const fields: FakeField[] = [];
  const scroll: { id: string; scrollTop: number; scrollHeight: number; clientHeight: number }[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0, reloads = 0;
  const document = Object.assign(new FakeTarget(), {
    hidden: false,
    activeElement: null as null | { closest: (selector: string) => unknown },
    documentElement: { scrollHeight: 2000, scrollWidth: 2000 },
    querySelectorAll: (selector: string) => selector === "input, textarea, select" ? fields : scroll,
    getElementById: (id: string) => scroll.find(el => el.id === id),
  });
  const window = Object.assign(new FakeTarget(), {
    Event, sessionStorage: storage,
    location: { href: "https://pebble.test/page", reload: () => { reloads++; } },
    performance: { getEntriesByType: () => [{ serverTiming: page ? [{ name: "bedrock-release", description: page }] : [] }] },
    scrollX: 10, scrollY: 200, innerWidth: 500, innerHeight: 500,
    scrollTo(x: number, y: number) { this.scrollX = x; this.scrollY = y; },
    setTimeout: function (this: unknown, fn: () => void, ms?: number) { hostReceiver(this, window, true); return clock.setTimeout(fn, ms); } as unknown as typeof setTimeout,
    clearTimeout: function (this: unknown, id: ReturnType<typeof setTimeout>) { hostReceiver(this, window, true); clock.clearTimeout(id); } as typeof clearTimeout,
    requestAnimationFrame(fn: FrameRequestCallback) { hostReceiver(this, window, true); const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id: number) { hostReceiver(this, window, true); frames.delete(id); },
  });
  const browser = { window, document, storage, now: () => clock.time, setTimeout: (fn: () => void, ms?: number) => window.setTimeout(fn, ms), clearTimeout: (id: ReturnType<typeof setTimeout>) => window.clearTimeout(id) } as unknown as Browser;
  function frame() { const callbacks = [...frames.values()]; frames.clear(); for (const fn of callbacks) fn(clock.time); }
  return { browser, window, document, storage, values, clock, fields, scroll, frame, frames, reloads: () => reloads };
}
