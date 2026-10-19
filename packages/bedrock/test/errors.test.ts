import { expect, spyOn, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BedrockError, definePebble, detached, mutation, publicRoute, query } from "../src";
import { createClient } from "../src/client";
import { startPebble } from "../src/runtime";
import { identityHeaders, tempDirectory } from "./helpers";

const candidates = ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"];
const ambiguous = () => new BedrockError("TIME_CONFLICT", "This local time is ambiguous.", "Choose one reading.", undefined, { data: { candidates } });
const caught = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a failure"); }, error => error);

test("pebble errors keep data and status over HTTP, WebSocket, public and detached routes", async () => {
  const temp = tempDirectory();
  const dir = join(temp.dir, "source");
  await mkdir(join(dir, "migrations"), { recursive: true });
  const pebble = definePebble({ name: "errors", access: "users", sync: true,
    queries: { ambiguous: query(() => { throw ambiguous(); }) },
    mutations: {
      ambiguous: mutation(() => { throw ambiguous(); }),
      teapot: mutation(() => { throw new BedrockError("BREWING", "Short and stout.", "Use a kettle.", undefined, { status: 418 }); }),
      crash: mutation(() => { throw new Error("boom"); }),
      unserializable: mutation(() => { throw new BedrockError("CUSTOM_NOT_FOUND", "Missing.", "Retry.", undefined, { data: 1n }); }),
    },
    routes: {
      "GET /public": publicRoute(() => { throw new BedrockError("EVENT_NOT_FOUND", "No event.", "Check the id.", undefined, { data: { id: "e1" } }); }),
      "GET /detached": detached(() => { throw new BedrockError("RATE_LIMITED", "Slow down.", "Retry later.", undefined, { data: { retryAfter: 5 } }); }),
      "GET /deliberate": () => { throw new BedrockError("OOPS", "Deliberate.", "Fix the request."); },
      "GET /crash": () => { throw new Error("boom"); },
    },
  });
  const running = await startPebble({ pebble, dir, dataDir: join(temp.dir, "data"), port: 0 });
  const headers = identityHeaders("reader");
  const client = createClient<typeof pebble>({ url: running.server.url.href, headers });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const get = async (path: string, init: RequestInit = { headers }) => {
    const response = await fetch(new URL(path, running.server.url), init);
    return { status: response.status, error: (await response.json()).error };
  };
  try {
    const http = await get("/_bedrock/m/ambiguous", { method: "POST", headers, body: "null" });
    expect(http).toEqual({ status: 409, error: { code: "TIME_CONFLICT", message: "This local time is ambiguous.", hint: "Choose one reading.", data: { candidates } } });
    expect(await caught(client.query("ambiguous", undefined))).toMatchObject({ code: "TIME_CONFLICT", status: 409, data: { candidates } });

    expect(await caught(client.mutate("ambiguous", undefined))).toMatchObject({ code: "TIME_CONFLICT", status: 409, data: { candidates } });
    expect(await caught(client.mutate("teapot", undefined))).toMatchObject({ code: "BREWING", status: 418 });
    expect(await caught(client.mutate("crash", undefined))).toMatchObject({ code: "FUNCTION_FAILED", status: 500 });
    const unserializable = await caught(client.mutate("unserializable", undefined));
    expect(unserializable).toMatchObject({ code: "CUSTOM_NOT_FOUND", status: 404 });
    expect(unserializable.data).toBeUndefined();
    const subscription = await new Promise(resolve => client.subscribe("ambiguous", undefined, () => {}, resolve));
    expect(subscription).toMatchObject({ code: "TIME_CONFLICT", status: 409, data: { candidates } });

    expect(await get("/public", {})).toMatchObject({ status: 404, error: { code: "EVENT_NOT_FOUND", data: { id: "e1" } } });
    expect(await get("/detached")).toMatchObject({ status: 429, error: { code: "RATE_LIMITED", data: { retryAfter: 5 } } });
    expect(await get("/deliberate")).toMatchObject({ status: 400, error: { code: "OOPS" } });
    expect(await get("/crash")).toMatchObject({ status: 500, error: { code: "FUNCTION_FAILED" } });
    expect(warn).toHaveBeenCalled();
  } finally { warn.mockRestore(); client.close(); await running.stop(); temp.cleanup(); }
});
