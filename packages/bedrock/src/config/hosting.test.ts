import { expect, test } from "bun:test";
import { definePebble, plugin, service, socket } from "./index";

test("hosting validates paths and detects plugin collisions", () => {
  const echo = socket({ message(ws, body) { ws.send(body); } });
  for (const path of ["relative", "/_bedrock", "/_bedrock/ws", "/host?query"]) expect(() => definePebble({ name: "host", sockets: { [path]: echo } })).toThrow();
  for (const path of ["../outside", "/absolute", "files", "uploads/foo", "db.sqlite", "a/../b", "a\\b", "C:/x"]) expect(() => definePebble({ name: "host", backup: { directories: [path] } })).toThrow();
  expect(() => definePebble({ name: "host", backup: { directories: ["a", "a/b"] } })).toThrow();
  expect(() => definePebble({ name: "host", sockets: { "/host": echo }, plugins: [plugin({ name: "extension", sockets: { "/host": echo } })] })).toThrow();
  const host = service({ start: () => 1 });
  expect(() => definePebble({ name: "host", services: { host }, plugins: [plugin({ name: "extension", services: { host } })] })).toThrow();
});

test("service values derive from service definitions for typed handler contexts", () => {
  const services = { host: service({ start: () => ({ answer: 42 }) }) };
  type Values = import("./hosting").ServicesOf<{ services: typeof services }>;
  const handler = (ctx: import("./types").FunctionContext<Values>) => {
    const answer: number = ctx.services.host.answer;
    // @ts-expect-error Service values preserve their declared result type.
    const wrong: string = ctx.services.host.answer;
    // @ts-expect-error Unregistered service names are rejected in typed contexts.
    ctx.services.missing;
    return answer;
  };
  expect(handler({ services: { host: { answer: 42 } } } as any)).toBe(42);
});
