import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { idleSourceSafe } from "./idle-source";

test("idle source guard follows local imports and fails closed on invisible work or unknown code", async () => {
  const temp = tempDirectory();
  try {
    const check = async (source: string) => {
      await Bun.write(join(temp.dir, "pebble.ts"), source);
      return idleSourceSafe(temp.dir);
    };
    expect(await check('import { definePebble } from "bedrock"; export default definePebble({name:"sample",web:"web"});')).toBe(true);
    await Bun.write(join(temp.dir, "route.ts"), 'export const handler = () => new Response(Bun.file("index.html"));');
    expect(await check('export { handler } from "./route";')).toBe(true);
    await Bun.write(join(temp.dir, "route.ts"), 'setInterval(() => {}, 1000);');
    expect(await check('import "./route";')).toBe(false);
    await Bun.write(join(temp.dir, "bunfig.toml"), '[serve.static]\nplugins = ["bedrock/bundler"]');
    expect(await check('import "bedrock";')).toBe(true);
    await Bun.write(join(temp.dir, "bunfig.toml"), 'preload = ["./background.ts"]');
    expect(await check('import "bedrock";')).toBe(false);
    await Bun.write(join(temp.dir, "bunfig.toml"), '[serve.static]\nplugins = ["bedrock/bundler"]');
    await Bun.write(join(temp.dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { bedrock: ["./background.ts"] } } }));
    expect(await check('import "bedrock";')).toBe(false);
    await Bun.write(join(temp.dir, "tsconfig.json"), '{}');
    for (const source of ['setTimeout(() => {}, 1000)', 'fetch("https://example.test")', 'Bun.sleep(1000)', 'new WebSocket("ws://example.test")', 'import "node:net"', 'import "valibot"', 'import "./missing"', 'import("./route")', 'globalThis["setTimeout"](() => {}, 1)']) {
      expect(await check(source)).toBe(false);
    }
  } finally { temp.cleanup(); }
});
