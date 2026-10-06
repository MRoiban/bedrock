import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sqliteTable, integer } from "drizzle-orm/sqlite-core";
import { definePebble, query, mutation } from "../src/config";
import { startPebble } from "../src/runtime";
import { createClient } from "../src/client";
import { tempDirectory } from "./helpers";

const selected = sqliteTable("selected", { side: integer().notNull() });
const left = sqliteTable("left_rows", { value: integer().notNull() });
const right = sqliteTable("right_rows", { value: integer().notNull() });
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 300; attempt++) { if (predicate()) return; await Bun.sleep(10); }
  throw new Error("Timed out");
}
test("reruns refresh dynamic read sets and coalesce a burst of commits", async () => {
  const temp = tempDirectory();
  mkdirSync(join(temp.dir, "migrations"));
  writeFileSync(join(temp.dir, "migrations/0000.sql"), `
    CREATE TABLE selected(side INTEGER NOT NULL); INSERT INTO selected VALUES(0);
    CREATE TABLE left_rows(value INTEGER NOT NULL); INSERT INTO left_rows VALUES(0);
    CREATE TABLE right_rows(value INTEGER NOT NULL); INSERT INTO right_rows VALUES(0);
  `);
  let runs = 0;
  const pebble = definePebble({ name: "readsets", sync: true, access: "public", schema: { selected, left, right }, queries: {
    current: query(({ db }) => {
      runs++;
      const side = db.select().from(selected).get()!.side;
      return db.select().from(side === 0 ? left : right).all();
    }),
  }, mutations: {
    chooseRight: mutation(({ db }) => db.update(selected).set({ side: 1 }).run()),
    left: mutation(({ db }) => db.update(left).set({ value: 9 }).run()),
    right: mutation(({ db }) => db.update(right).set({ value: 9 }).run()),
  } });
  const running = await startPebble({ pebble, dir: temp.dir, dataDir: join(temp.dir, "data"), port: 0 });
  const client = createClient<typeof pebble>({ url: running.server.url.href });
  const values: unknown[] = [];
  client.subscribe("current", undefined, data => values.push(data));
  try {
    await until(() => values.length === 1);
    const request = new Request(running.server.url);
    await running.execute("mutation", "chooseRight", undefined, request);
    await until(() => runs === 2);
    expect(values).toHaveLength(1);
    await running.execute("mutation", "left", undefined, request);
    await Bun.sleep(50);
    expect(runs).toBe(2);
    await Promise.all(Array.from({ length: 8 }, () => running.execute("mutation", "right", undefined, request)));
    await until(() => values.length === 2);
    expect(runs).toBe(3);
    expect(values.at(-1)).toEqual([{ value: 9 }]);
  } finally { client.close(); await running.stop(); temp.cleanup(); }
});
