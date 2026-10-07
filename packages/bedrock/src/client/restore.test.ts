import { expect, test } from "bun:test";
import { restorePlace, savePlace } from "./restore";
import { fakeBrowser, FakeField } from "./browser-fake";

function field(id: string, value: string, type = "text", name = "") {
  return Object.assign(new FakeField(), { id, value, type, name });
}
test("save and restore fields via native setters and bubbling events before window and element scroll", () => {
  const env = fakeBrowser();
  const title = field("title", "hello"), checked = field("check", "", "checkbox"); checked.checked = true;
  env.fields.push(title, checked, field("", "one", "text", "same"), field("", "two", "text", "same"));
  for (const type of ["password", "hidden", "file"]) env.fields.push(field(type, "secret", type));
  env.scroll.push({ id: "list", scrollTop: 80, scrollHeight: 300, clientHeight: 100 });
  savePlace(env.browser);
  const saved = JSON.parse(env.values.get("bedrock:restore")!);
  expect(saved.fields).toEqual({ title: "hello", check: true, "same:0": "one", "same:1": "two" });
  env.fields.splice(0, env.fields.length);
  env.window.scrollTo(0, 0); env.scroll[0]!.scrollTop = 0;
  const restore = restorePlace(env.browser);
  restore.subscribe("a"); restore.subscribe("b");
  env.frame(); expect(env.window.scrollY).toBe(0);
  const late = field("title", ""); const events: string[] = [];
  late.addEventListener("input", event => { expect(event.bubbles).toBe(true); events.push(event.type); });
  late.addEventListener("change", event => events.push(event.type));
  let ownSetter = 0;
  Object.defineProperty(late, "value", { get: () => Object.getOwnPropertyDescriptor(FakeField.prototype, "value")!.get!.call(late), set: () => { ownSetter++; } });
  env.fields.push(late, field("check", "", "checkbox"), field("", "", "text", "same"), field("", "", "text", "same"));
  env.frame(); expect(late.value).toBe("hello"); expect(ownSetter).toBe(0); expect(events).toEqual(["input", "change"]);
  expect((env.fields[1] as FakeField).checked).toBe(true);
  restore.data("a"); env.frame(); expect(env.window.scrollY).toBe(0);
  restore.data("b"); env.frame(); expect(env.window.scrollY).toBe(200); expect(env.scroll[0]!.scrollTop).toBe(80);
  expect(env.values.has("bedrock:restore")).toBe(false);
  restore.close(); expect(env.frames.size).toBe(0);
});

test("restore waits at most two seconds for data and retries short pages for one second", () => {
  const env = fakeBrowser(); savePlace(env.browser);
  env.document.documentElement.scrollHeight = 500; env.window.scrollY = 0;
  const restore = restorePlace(env.browser); restore.subscribe("slow");
  env.clock.advance(1999); env.frame(); expect(env.window.scrollY).toBe(0);
  env.clock.advance(1); expect(env.window.scrollY).toBe(200);
  expect(env.values.has("bedrock:restore")).toBe(true);
  env.clock.advance(999); env.frame(); expect(env.values.has("bedrock:restore")).toBe(true);
  env.clock.advance(1); env.frame(); expect(env.values.has("bedrock:restore")).toBe(false);
  restore.close();
});

test("restore expires after thirty seconds and requires the exact URL", () => {
  for (const mismatch of [false, true]) {
    const env = fakeBrowser(); env.fields.push(field("title", "old")); savePlace(env.browser); env.fields[0]!.value = "new";
    if (mismatch) env.window.location.href += "#other"; else env.clock.advance(30_001);
    const restore = restorePlace(env.browser); env.frame();
    expect(env.fields[0]!.value).toBe("new"); expect(env.values.has("bedrock:restore")).toBe(false); restore.close();
  }
});
