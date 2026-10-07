import { expect, test } from "bun:test";
import { fakeBrowser } from "./browser-fake";

test("fake host functions reject foreign receivers and accept their owner", () => {
  const env = fakeBrowser();
  const calls = [
    { owner: env.window, fn: env.window.setTimeout, args: [() => {}, 0] },
    { owner: env.window, fn: env.window.clearTimeout, args: [undefined] },
    { owner: env.window, fn: env.window.requestAnimationFrame, args: [() => {}] },
    { owner: env.window, fn: env.window.cancelAnimationFrame, args: [0] },
    { owner: env.storage, fn: env.storage.getItem, args: ["key"] },
    { owner: env.storage, fn: env.storage.setItem, args: ["key", "value"] },
    { owner: env.storage, fn: env.storage.removeItem, args: ["key"] },
  ];
  for (const { owner, fn, args } of calls) {
    expect(() => Reflect.apply(fn, {}, args)).toThrow(new TypeError("Illegal invocation"));
    expect(() => Reflect.apply(fn, owner, args)).not.toThrow();
    for (const receiver of [undefined, globalThis]) {
      if (owner === env.window) expect(() => Reflect.apply(fn, receiver, args)).not.toThrow();
      else expect(() => Reflect.apply(fn, receiver, args)).toThrow(new TypeError("Illegal invocation"));
    }
  }
});
