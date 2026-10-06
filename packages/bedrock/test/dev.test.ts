import { linkDependencies } from "./helpers";
import { test, expect } from "bun:test";
import { join, resolve } from "node:path";
import { tempDirectory } from "./helpers";

test("dev emits one JSON object, restarts on edits, and retains data", async () => {
  const temp = tempDirectory();
  linkDependencies(resolve(import.meta.dir, "../../../examples/notes/node_modules"), join(temp.dir, "node_modules"));
  const source = `import { definePebble, query, mutation, sqliteTable, text } from "bedrock";
const items = sqliteTable("items", { id: text("id").primaryKey() });
export default definePebble({ name: "devtest", schema: { items },
  queries: { list: query(({db}) => db.select().from(items)) },
  mutations: { add: mutation(({db}) => db.insert(items).values({id: "saved"}).returning()) },
  routes: { "GET /version": () => new Response("v1") }
});
`;
  await Bun.write(join(temp.dir, "pebble.ts"), source);
  await Bun.write(join(temp.dir, "migrations/0000.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY)");
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/cli/index.ts"), "dev", "--port", "0", "--json"], {
    cwd: temp.dir, env: { ...process.env, BEDROCK_HOME: join(temp.dir, "isolated-home") },
    stdout: "pipe", stderr: "pipe",
  });
  let stdout = "";
  let stderr = "";
  const read = async (stream: ReadableStream<Uint8Array>, append: (text: string) => void) => {
    for await (const chunk of stream) append(new TextDecoder().decode(chunk));
  };
  const reading = Promise.all([read(child.stdout, text => { stdout += text; }), read(child.stderr, text => { stderr += text; })]);
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out. stdout=${stdout}; stderr=${stderr}`);
      await Bun.sleep(20);
    }
  };
  try {
    await until(() => stdout.includes("\n"));
    const started = JSON.parse(stdout.trim());
    expect(started.ok).toBe(true);
    const request = (url: URL, init: RequestInit = {}) => {
      const host = url.host;
      url.hostname = "127.0.0.1";
      return fetch(url, { ...init, headers: { ...init.headers, host } });
    };
    const add = await request(new URL("/_bedrock/m/add", started.url), { method: "POST", body: "null", headers: { origin: new URL(started.url).origin } });
    expect((await add.json()).value).toEqual([{ id: "saved" }]);
    await Bun.write(join(temp.dir, "pebble.ts"), source.replace('"v1"', '"v2"'));
    await until(() => /Restarted devtest: (http:\/\/[^\s]+)/.test(stderr));
    const newUrl = /Restarted devtest: (http:\/\/[^\s]+)/.exec(stderr)![1]!;
    expect(await (await request(new URL("/version", newUrl))).text()).toBe("v2");
    const listed = await request(new URL("/_bedrock/q/list", newUrl), { method: "POST", body: "null", headers: { origin: new URL(newUrl).origin } });
    expect((await listed.json()).value).toEqual([{ id: "saved" }]);
    expect(stdout.trim().split("\n")).toHaveLength(1);
  } finally {
    child.kill("SIGTERM");
    await child.exited;
    await reading;
    temp.cleanup();
  }
}, 15000);
