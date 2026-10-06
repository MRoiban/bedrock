import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { startPebble } from "../src/runtime";
import { tempDirectory, identityHeaders } from "./helpers";

test("notes example serves bundled UI, adds and lists notes over HTTP, and verifies signed identity", async () => {
  const temp = tempDirectory();
  const running = await startPebble({ dir: resolve(import.meta.dir, "../../../examples/notes"), dataDir: temp.dir, port: 0 });
  const headers = { "Content-Type": "application/json", ...identityHeaders("alice") };
  const call = (path: string, args: unknown, userHeaders: HeadersInit = headers) => fetch(new URL(path, running.server.url), { method: "POST", headers: userHeaders, body: JSON.stringify(args) });
  try {
    expect((await call("/_bedrock/q/mine", null, { "Content-Type": "application/json" })).status).toBe(401);
    const added = await (await call("/_bedrock/m/add", { body: "Hello, bedrock" })).json();
    expect(added.ok).toBe(true);
    expect(added.value[0].body).toBe("Hello, bedrock");
    const listed = await (await call("/_bedrock/q/mine", null)).json();
    expect(listed.value).toHaveLength(1);
    const bob = { ...headers, ...identityHeaders("bob") };
    expect((await (await call("/_bedrock/q/mine", null, bob)).json()).value).toEqual([]);
    expect((await call("/_bedrock/m/add", { body: "" })).status).toBe(400);
    expect((await call("/_bedrock/q/missing", null)).status).toBe(404);
    const page = await fetch(running.server.url);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Your notes");
    const script = /src="([^"]+\.js[^"]*)"/.exec(html);
    expect(script).not.toBeNull();
    expect((await fetch(new URL(script![1]!, running.server.url))).status).toBe(200);
    expect(await (await fetch(new URL("/api/health", running.server.url))).text()).toBe("ok");
  } finally {
    await running.stop();
    temp.cleanup();
  }
});
