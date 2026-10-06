import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startDaemon } from "../src/daemon";
import { setup } from "../src/daemon/config";
import { backupSetup } from "../src/backup";
import { createArchive } from "../src/daemon/archive";
import { tempDirectory } from "./helpers";

test("daemon CLI detached jobs, backup run/list/restore with files, rollback refusal and explicit force", async () => {
  const temp = tempDirectory();
  const home = join(temp.dir, "home");
  const dir = join(temp.dir, "source");
  const cli = resolve(import.meta.dir, "../src/cli/index.ts");
  await setup(home, "example.test", "creator@example.test", 0);
  await backupSetup(home, { type: "fs", directory: join(temp.dir, "backups") });
  const daemon = await startDaemon({ home });
  const token = (await Bun.file(join(home, "admin-token")).text()).trim();
  const api = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { host: "bedrock.localhost", authorization: `Bearer ${token}`, ...init.headers } });
  const command = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, cli, ...args, "--json"], { cwd: temp.dir, env: { ...process.env, BEDROCK_HOME: home, XDG_CONFIG_HOME: join(temp.dir, "credentials") }, stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { body: JSON.parse(out), code };
  };
  const deploy = async () => { const archive = join(temp.dir, "release.tar.gz"); await createArchive(dir, archive); return (await api("/api/deploy?name=sample", { method: "POST", body: Bun.file(archive) })).json(); };
  await mkdir(join(dir, "migrations"), { recursive: true });
  await Bun.write(join(dir, "migrations", "0000.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY)");
  await Bun.write(join(dir, "pebble.ts"), `import { definePebble, query, mutation, job, bucket, sqliteTable, text } from "bedrock";
const items = sqliteTable("items", { id: text("id").primaryKey() });
const attachments = bucket("attachments", { maxSize: "1mb", access: "public" });
export default definePebble({ name: "sample", schema: { items }, storage: [attachments],
queries: { list: query(ctx => ctx.db.select().from(items)), files: query(ctx => ctx.storage.list(attachments)) },
mutations: { add: mutation(ctx => ctx.db.insert(items).values({ id: "manual" }).run()), upload: mutation(ctx => ctx.storage.put(attachments, new Blob(["attachment"]), { name: "test.txt" })) },
jobs: { sweep: job("0 0 31 2 *", async ctx => { if (ctx.user !== null) throw new Error("expected anonymous job"); await ctx.write(slot => { if (slot.user !== null) throw new Error("expected anonymous slot"); slot.db.insert(items).values({ id: crypto.randomUUID() }).run(); }); }, { transaction: false }) } });`);
  try {
    expect((await deploy()).ok).toBe(true);
    expect((await command(["--version"])).body.version).toBe("0.1.0");
    expect((await command(["jobs", "ls", "sample"])).body.value).toEqual([{ name: "sweep", cron: "0 0 31 2 *", running: false }]);
    expect((await command(["jobs", "run", "sample", "sweep"])).body.value.skipped).toBe(false);
    const functionCall = async (kind: string, name: string) => (await (await fetch(new URL(`/_bedrock/${kind}/${name}`, daemon.server.url), { method: "POST", headers: { host: "sample.localhost", origin: "http://sample.localhost" }, body: "null" })).json()).value;
    const file = await functionCall("m", "upload");
    const backup = await command(["backup", "run", "sample"]);
    expect(backup.code).toBe(0);
    expect(backup.body.value).toHaveLength(2);
    expect(await Bun.file(join(temp.dir, "backups", "daemon", "db", `${backup.body.value[1].timestamp.replaceAll(":", "-")}.sqlite.gz`)).exists()).toBe(true);
    expect((await command(["backup", "ls", "sample"])).body.value).toHaveLength(1);
    await functionCall("m", "add");
    expect(await functionCall("q", "list")).toHaveLength(2);
    expect((await command(["backup", "restore", "sample"])).body.error.code).toBe("CONFIRM_REQUIRED");
    const restored = await command(["backup", "restore", "sample", "--yes"]);
    expect(restored.code).toBe(0);
    expect(await Bun.file(join(restored.body.value.previous, "db.sqlite")).exists()).toBe(true);
    expect(await functionCall("q", "list")).toHaveLength(1);
    expect((await functionCall("q", "files"))[0].id).toBe(file.id);
    const fileResponse = await fetch(new URL(`/_bedrock/files/attachments/${file.id}`, daemon.server.url), { headers: { host: "sample.localhost" } });
    expect(await fileResponse.text()).toBe("attachment");
    await Bun.write(join(dir, "migrations", "0001.sql"), "CREATE TABLE more (id TEXT)");
    expect((await deploy()).ok).toBe(true);
    expect((await command(["rollback", "sample"])).body.error.code).toBe("ROLLBACK_MIGRATIONS");
    expect((await command(["rollback", "sample", "--force"])).code).toBe(0);
    expect((await api("/api/backup/run", { method: "POST", headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  } finally { await daemon.stop(); temp.cleanup(); }
}, 30000);
