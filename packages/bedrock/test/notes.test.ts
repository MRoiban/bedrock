import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { startPebble } from "../src/runtime";
import { tempDirectory } from "./helpers";

test("notes example serves bundled UI, adds and lists notes over HTTP, and gates development identity", async () => {
  const temp = tempDirectory();
  const previous = process.env.BEDROCK_INSECURE_DEV_USER;
  const running = await startPebble({ dir: resolve(import.meta.dir, "../../../examples/notes"), dataDir: temp.dir, port: 0 });
  const headers = { "Content-Type": "application/json", "x-bedrock-user": JSON.stringify({ id: "alice", email: "alice@example.test" }) };
  const call = (path: string, args: unknown, userHeaders = headers) => fetch(new URL(path, running.server.url), { method: "POST", headers: userHeaders, body: JSON.stringify(args) });
  try {
    delete process.env.BEDROCK_INSECURE_DEV_USER;
    expect((await call("/_bedrock/q/mine", null)).status).toBe(401);
    process.env.BEDROCK_INSECURE_DEV_USER = "1";
    const added = await (await call("/_bedrock/m/add", { body: "Hello, bedrock" })).json();
    expect(added.ok).toBe(true);
    expect(added.value[0].body).toBe("Hello, bedrock");
    const listed = await (await call("/_bedrock/q/mine", null)).json();
    expect(listed.value).toHaveLength(1);
    const bob = { ...headers, "x-bedrock-user": JSON.stringify({ id: "bob" }) };
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
    if (previous === undefined) delete process.env.BEDROCK_INSECURE_DEV_USER; else process.env.BEDROCK_INSECURE_DEV_USER = previous;
    temp.cleanup();
  }
});
