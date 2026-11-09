import { expect, test } from "bun:test";
import { join } from "node:path";
import { Telemetry } from "../src/daemon/telemetry";
import { errorEvent } from "../src/errors/model";
import { tempDirectory } from "./helpers";

test("R3-3 twenty reports of twenty repeated out-of-range frames preserve the shared telemetry Worker", async () => {
  const temp = tempDirectory(), telemetry = new Telemetry(temp.dir, () => []);
  try {
    const root = join(temp.dir, "pebbles/p/releases/r1/.bedrock-web");
    await Bun.write(join(root, "manifest.json"), JSON.stringify({ maps: { "/app.js": "maps/app.map" } }));
    const map = JSON.stringify({ version: 3, sources: ["app.ts"], names: [], mappings: "AAAA;".repeat(620000) });
    expect(Buffer.byteLength(map)).toBeGreaterThanOrEqual(3100000);
    await Bun.write(join(root, "maps/app.map"), map);
    const frames = Array.from({ length: 20 }, () => ({ file: "/app.js", function: "fail", line: 1000000, column: 1 }));
    const records = Array.from({ length: 20 }, () => ({ ...errorEvent(new TypeError("probe"), "browser", "unhandled-error", "r1"), frames }));
    const started = performance.now();
    expect(telemetry.errors.accept("p", records)).toBeNull();
    const page = await telemetry.errors.query("p");
    const metrics = await telemetry.query({ kind: "metrics", pebble: "unrelated", from: Date.now() - 60000, to: Date.now(), step: 60000, limit: 100 });
    const elapsed = performance.now() - started;
    console.log(`R3-3 20 x 20 frames / ${Buffer.byteLength(map)}-byte map + metrics: ${elapsed.toFixed(1)} ms`);
    expect(page.issues).toHaveLength(1);
    expect(page.issues[0].missing_maps).toBe(1);
    expect(metrics).toBeDefined();
    expect(elapsed).toBeLessThan(1500);
  } finally { await telemetry.close(); temp.cleanup(); }
}, 15000);
