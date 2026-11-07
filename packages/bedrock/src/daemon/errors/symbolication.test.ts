import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../../test/helpers";
import { originalPosition } from "../source-maps";
import { indexMap, indexedPosition } from "./map-index";
import { SourceMapCache, SymbolicationBatch } from "./symbolication";

test("indexed maps preserve VLQ state, gaps, names and nearest positions", () => {
  const map = { version: 3, sources: ["a.ts", "b.ts"], names: ["first", "second"], mappings: "AAAAA,K,ECGGC;AACF;;A" };
  const indexed = indexMap(map, 200, () => true)!;
  for (let line = 1; line <= 5; line++) for (let column = 1; column <= 12; column++) {
    expect(indexedPosition(indexed, line, column)).toEqual(originalPosition(map, line, column));
  }
  expect(indexMap(map, 200, () => false)).toBeNull();
  expect(indexMap(map, 200, () => true, 100)).toBeNull();
});

test("source map cache evicts by bytes in LRU order and skips oversized entries", () => {
  const map = indexMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA" }, 100, () => true)!;
  const charge = map.bytes + 258, cache = new SourceMapCache(charge * 3);
  cache.put("a", map); cache.put("b", map); cache.put("c", map);
  expect(cache.get("a")).toBe(map);
  cache.put("d", map);
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("c")).toBe(map);
  expect(cache.bytes).toBeLessThanOrEqual(cache.limit);
  cache.put("large", { ...map, bytes: cache.limit + 1 });
  expect(cache.get("large")).toBeUndefined();
  cache.put("d", map);
  expect(cache.bytes).toBe(charge * 3);
});

test("symbolication deduplicates positions and reuses indexed maps across batches", async () => {
  const temp = tempDirectory(), cache = new SourceMapCache();
  try {
    const root = join(temp.dir, "r1/.bedrock-web"), path = join(root, "maps/app.map");
    await Bun.write(join(root, "manifest.json"), JSON.stringify({ maps: { "/app.js": "maps/app.map" } }));
    await Bun.write(path, JSON.stringify({ version: 3, sources: ["app.ts"], names: [], mappings: "AAAA" }));
    const batch = new SymbolicationBatch(cache);
    const first = batch.position(temp.dir, "r1", "/app.js", 1, 1);
    expect(batch.position(temp.dir, "r1", "/app.js", 1, 1)).toBe(first);
    expect(await first).toMatchObject({ source: "app.ts", line: 1 });
    expect(cache.bytes).toBeGreaterThan(0);
    // Retained release maps are immutable; a poisoned file proves this lookup uses the cache.
    await Bun.write(path, "invalid");
    expect(await new SymbolicationBatch(cache).position(temp.dir, "r1", "/app.js", 1, 1)).toMatchObject({ source: "app.ts" });
    expect(await batch.position(temp.dir, "r1", "/../app.js", 1, 1)).toBeNull();
  } finally { temp.cleanup(); }
});
