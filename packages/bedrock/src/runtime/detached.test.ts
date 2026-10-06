import { expect, test } from "bun:test";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bucket, definePebble, job, mutation, type FunctionContext } from "../config";
import { openDatabase } from "../db";
import { createJobs } from "../jobs";
import { tempDirectory } from "../../test/helpers";
import { createExecutor } from "./functions";

function fixture() {
  const temp = tempDirectory();
  const items = sqliteTable("items", { id: text("id").primaryKey() });
  const attachments = bucket("attachments", { maxSize: "1mb", access: "public" });
  const database = openDatabase(temp.dir, { items });
  database.sqlite.exec("CREATE TABLE items (id TEXT PRIMARY KEY)");
  const execute = createExecutor(definePebble({ name: "detached", access: "users", schema: { items }, storage: [attachments],
    mutations: { add: mutation(ctx => ctx.db.insert(items).values({ id: "mutation" }).run()) },
  }), database);
  return { items, attachments, database, execute, async close() { await execute.close(); database.close(); temp.cleanup(); } };
}
const request = new Request("http://localhost/test");

test("detached slots retain identity, read-only enforcement, rollback, storage and commit tracking", async () => {
  const { items, execute, close } = fixture();
  const notifications: string[][] = [];
  execute.onCommit(writes => notifications.push([...writes]));
  try {
    await execute.detached(request, async ctx => {
      expect(ctx.user).toEqual({ id: "reader" });
      expect(ctx.request).toBe(request);
      expect(() => (ctx as unknown as FunctionContext).db).toThrow(expect.objectContaining({ code: "DETACHED_CONTEXT", hint: expect.stringContaining("ctx.read") }));
      expect(() => (ctx as unknown as FunctionContext).storage).toThrow(expect.objectContaining({ code: "DETACHED_CONTEXT" }));
      await ctx.write(slot => {
        expect(slot.user).toEqual(ctx.user);
        expect(slot.storage).toBeDefined();
        slot.db.insert(items).values({ id: "committed" }).run();
      });
      await expect(ctx.write(slot => {
        slot.db.insert(items).values({ id: "rollback" }).run();
        throw new Error("slot failed");
      })).rejects.toMatchObject({ code: "FUNCTION_FAILED", message: "slot failed" });
      await expect(ctx.read(slot => slot.db.insert(items).values({ id: "read-write" }).run())).rejects.toMatchObject({ code: "FUNCTION_FAILED" });
      expect(await ctx.read(slot => slot.db.select().from(items).all())).toEqual([{ id: "committed" }]);
      await ctx.write(slot => { slot.db.$client.exec("INSERT INTO items VALUES ('raw')"); slot.invalidate([items]); });
    }, { user: { id: "reader" } });
    expect(notifications).toEqual([["items"], ["items"]]);
  } finally { await close(); }
});

test("ordinary routes still hold their queued write transaction across awaits", async () => {
  const { execute, close } = fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const order: string[] = [];
  try {
    const route = execute.route(request, async () => { entered(); await gate; order.push("route"); });
    await started;
    const mutation = execute("mutation", "add", null, request, { user: { id: "reader" } }).then(() => order.push("mutation"));
    await Bun.sleep(20);
    expect(order).toEqual([]);
    release(); await Promise.all([route, mutation]);
    expect(order).toEqual(["route", "mutation"]);
  } finally { release(); await close(); }
});

test("detached scheduled jobs keep anonymous slots and skip overlapping scheduled/manual runs", async () => {
  const { items, execute, close } = fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let count = 0;
  let now = new Date(2026, 9, 6, 3, 0);
  const jobs = createJobs({ refresh: job("* * * * *", async ctx => {
    expect(ctx.user).toBeNull();
    count++; entered(); await gate;
    await ctx.write(slot => { expect(slot.user).toBeNull(); slot.db.insert(items).values({ id: `job-${count}` }).run(); });
    const rows = await ctx.read(slot => { expect(slot.user).toBeNull(); return slot.db.select().from(items).all(); });
    expect(rows.filter(row => row.id.startsWith("job-"))).toHaveLength(count);
  }, { transaction: false }) }, (_name, _handler, definition) => definition.transaction === false
    ? execute.detached(request, definition.run, { user: null }) : execute.job(definition.run), () => now);
  try {
    jobs.tick(); await started;
    expect(await jobs.run("refresh")).toEqual({ name: "refresh", skipped: true });
    now = new Date(2026, 9, 6, 3, 1); jobs.tick();
    expect(count).toBe(1);
    await execute("mutation", "add", null, request, { user: { id: "reader" } });
    release();
    const deadline = Date.now() + 2000;
    while (jobs.list()[0]!.running) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for scheduled job");
      await Bun.sleep(1);
    }
    expect(await jobs.run("refresh")).toEqual({ name: "refresh", skipped: false });
    expect(count).toBe(2);
  } finally { release(); await jobs.stop(); await close(); }
});


test("detached storage slots commit files and clean up failed writes", async () => {
  const { attachments, database, execute, close } = fixture();
  try {
    await execute.detached(request, async ctx => {
      const file = await ctx.write(slot => slot.storage.put(attachments, new Blob(["kept"]), { name: "kept.txt" }));
      let rolledBackId = "";
      await expect(ctx.write(async slot => {
        rolledBackId = (await slot.storage.put(attachments, new Blob(["discarded"]), { name: "discarded.txt" })).id;
        throw new Error("storage failed");
      })).rejects.toThrow("storage failed");
      expect(await Bun.file(`${database.dataDir}/files/attachments/${rolledBackId}`).exists()).toBe(false);
      const remaining = await ctx.read(slot => slot.storage.list(attachments));
      expect(remaining.map(item => item.id)).toEqual([file.id]);
      const blob = await ctx.read(slot => slot.storage.get(attachments, file.id));
      expect(await blob.text()).toBe("kept");
      await expect(ctx.read(slot => slot.storage.delete(attachments, file.id))).rejects.toMatchObject({ code: "READ_ONLY" });
    }, { user: null });
  } finally { await close(); }
});
