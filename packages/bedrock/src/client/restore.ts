import type { Browser } from "./browser";
const KEY = "bedrock:restore";
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
interface Place { url: string; at: number; scrollX: number; scrollY: number; scroll: Record<string, number>; fields: Record<string, string | boolean> }
function fields(document: Document) {
  const counts = new Map<string, number>();
  return Array.from(document.querySelectorAll<Field>("input, textarea, select")).flatMap(field => {
    const index = counts.get(field.name) ?? 0;
    counts.set(field.name, index + 1);
    if (field.tagName === "INPUT" && ["password", "file", "hidden"].includes(field.type)) return [];
    const key = field.id || (field.name ? `${field.name}:${index}` : "");
    return key ? [{ key, field }] : [];
  });
}
export function savePlace({ window, document, storage, now }: Browser) {
  const scroll = Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>("[id][data-bedrock-keep-scroll]")).map(el => [el.id, el.scrollTop]));
  const values = Object.fromEntries(fields(document).map(({ key, field }) => [key, ["checkbox", "radio"].includes(field.type) ? (field as HTMLInputElement).checked : field.value]));
  storage.setItem(KEY, JSON.stringify({ url: window.location.href, at: now(), scrollX: window.scrollX, scrollY: window.scrollY, scroll, fields: values }));
}
export function restorePlace(browser: Browser | undefined) {
  const waiting = new Set<string>();
  const started = browser?.now() ?? 0;
  let frame: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let sawSubscription = false;
  let place: Place | undefined, scrollingAt: number | undefined, closed = false;
  if (browser) try {
    const parsed = JSON.parse(browser.storage.getItem(KEY) ?? "null");
    if (parsed && parsed.url === browser.window.location.href && browser.now() - parsed.at >= 0 && browser.now() - parsed.at <= 30_000
      && Number.isFinite(parsed.scrollX) && Number.isFinite(parsed.scrollY) && parsed.fields && parsed.scroll) place = parsed;
    else browser.storage.removeItem(KEY);
  } catch { try { browser.storage.removeItem(KEY); } catch {} }
  const restored = new Set<string>();
  function tick() {
    if (!browser || !place || closed) return;
    const { window, document, now } = browser;
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
    for (const { key, field } of fields(document)) {
      const value = place.fields[key];
      if (value === undefined || restored.has(key)) continue;
      const checkable = field.tagName === "INPUT" && ["checkbox", "radio"].includes(field.type);
      if (typeof value !== (checkable ? "boolean" : "string")) continue;
      const property = typeof value === "boolean" ? "checked" : "value";
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), property)?.set;
      if (!setter) continue;
      setter.call(field, value);
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
      field.dispatchEvent(new window.Event("change", { bubbles: true }));
      restored.add(key);
    }
    if ((sawSubscription && waiting.size === 0) || now() - started >= 2000) {
      scrollingAt ??= now();
      window.scrollTo(place.scrollX, place.scrollY);
      let short = document.documentElement.scrollHeight - window.innerHeight < place.scrollY
        || document.documentElement.scrollWidth - window.innerWidth < place.scrollX;
      for (const [id, top] of Object.entries(place.scroll)) {
        const element = document.getElementById(id);
        if (element) { element.scrollTop = top; short ||= element.scrollHeight - element.clientHeight < top; }
        else short = true;
      }
      const missingFields = Object.keys(place.fields).some(key => !restored.has(key));
      if ((!short && !missingFields) || now() - scrollingAt >= 1000) {
        try { browser.storage.removeItem(KEY); } catch {}
        if (timer) browser.clearTimeout(timer);
        place = undefined;
        return;
      }
    }
    frame = window.requestAnimationFrame(tick);
  }
  if (browser && place) {
    frame = browser.window.requestAnimationFrame(tick);
    timer = browser.setTimeout(tick, 2000);
  }
  return {
    subscribe(id: string) { if (browser && browser.now() - started < 2000) { sawSubscription = true; waiting.add(id); } },
    data(id: string) { waiting.delete(id); },
    unsubscribe(id: string) { waiting.delete(id); },
    close() { closed = true; if (frame !== undefined) browser?.window.cancelAnimationFrame(frame); if (timer) browser?.clearTimeout(timer); },
  };
}
