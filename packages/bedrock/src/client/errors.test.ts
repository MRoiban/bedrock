import { expect, test } from "bun:test";
import type { Browser } from "./browser";
import { browserErrors } from "./errors";

function environment(beacon: (url: string, body: string) => boolean = () => false) {
  const window = Object.assign(new EventTarget(), { location: { origin: "https://p.test" }, navigator: { userAgent: "Mozilla/5.0 Chrome/123 Headless", sendBeacon: beacon } });
  const document = Object.assign(new EventTarget(), { hidden: false });
  const browser = { window, document } as unknown as Browser;
  return { browser, window, document, error() { window.dispatchEvent(Object.assign(new Event("error"), { error: new Error("token=secret x@y.test") })); } };
}
test("browser errors bound batches and client rate, scrub after filters, restore listeners and honor backoff", async () => {
  const original = globalThis.fetch, requests: { init: RequestInit; body: any }[] = [];
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => { requests.push({ init, body: JSON.parse(init.body as string) }); return new Response("", { status: 202 }); }) as unknown as typeof fetch;
  const e = environment();
  const client = browserErrors(e.browser, new URL("https://p.test"), () => "r1", { beforeSend: event => ({ ...event, message: "password=hidden", cookie: "private" }) });
  try {
    for (let i = 0; i < 30; i++) e.error();
    for (let i = 0; i < 5; i++) { await Bun.sleep(0); e.window.dispatchEvent(new Event("pagehide")); }
    await Bun.sleep(0);
    expect(requests.flatMap(r => r.body.events)).toHaveLength(20);
    expect(requests.every(r => r.body.events.length <= 5)).toBe(true);
    expect(requests.every(r => !new Headers(r.init.headers).has("authorization"))).toBe(true);
    expect(JSON.stringify(requests)).not.toContain("hidden"); expect(JSON.stringify(requests)).not.toContain("private");
    expect(requests[0]!.body.events[0]).toMatchObject({ release: "r1", browser: "Chrome", bot: true });
    client.close(); const size = requests.length; e.error(); e.window.dispatchEvent(new Event("pagehide")); await Bun.sleep(0); expect(requests).toHaveLength(size);
    const next = environment();
    globalThis.fetch = (async () => { requests.push({ init: {}, body: {} }); return new Response("", { status: 429, headers: { "retry-after": "60" } }); }) as unknown as typeof fetch;
    const backoff = browserErrors(next.browser, new URL("https://p.test"), () => "r1", undefined);
    for (let i = 0; i < 5; i++) next.error(); await Bun.sleep(0);
    const count = requests.length; for (let i = 0; i < 10; i++) next.error(); next.window.dispatchEvent(new Event("pagehide")); await Bun.sleep(0);
    expect(requests).toHaveLength(count); backoff.close();
  } finally { client.close(); globalThis.fetch = original; }
});
test("browser errors beacon on hide and stay disabled for opt-out or another origin", () => {
  const beacons: any[] = [], e = environment((_url, body) => { beacons.push(JSON.parse(body)); return true; });
  const client = browserErrors(e.browser, new URL("https://p.test"), () => "r1", undefined);
  e.error(); e.document.hidden = true; e.document.dispatchEvent(new Event("visibilitychange"));
  expect(beacons).toHaveLength(1); expect(beacons[0].events).toHaveLength(1); client.close();
  for (const [url, options] of [["https://p.test", false], ["https://other.test", undefined]] as const) {
    const disabled = browserErrors(e.browser, new URL(url), () => "r1", options); e.error(); e.window.dispatchEvent(new Event("pagehide")); disabled.close();
  }
  expect(beacons).toHaveLength(1);
});
