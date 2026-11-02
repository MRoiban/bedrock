import { expect, test } from "bun:test";
import { mkdir, readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { detectCgroups, emptyMemory, PebbleCgroups } from "./cgroups";

async function fixture(leaf = false) {
  const temp = tempDirectory(), root = join(temp.dir, "cgroup"), proc = join(temp.dir, "proc"), service = join(root, "test.scope");
  await Bun.write(join(proc, "self/cgroup"), `0::/test.scope${leaf ? "/supervisor" : ""}\n`);
  await Bun.write(join(proc, "meminfo"), "MemTotal:       16777216 kB\nSwapFree:       8388608 kB\n");
  await Bun.write(join(service, "cgroup.controllers"), "cpu memory pids\n");
  await Bun.write(join(service, "cgroup.subtree_control"), "");
  await Bun.write(join(service, "memory.reclaim"), "");
  await Bun.write(join(service, "memory.swap.current"), "0");
  await Bun.write(join(service, "cgroup.procs"), leaf ? "" : "123\n456\n");
  const logs: string[] = [];
  const options = { root, proc, platform: "linux", log: (message: string) => { logs.push(message); } };
  return { ...temp, root, proc, service, logs, options };
}

for (const reason of ["darwin", "win32", "dev", "v1", "controller", "writable"]) test(`cgroups disable once without mutations: ${reason}`, async () => {
  const f = await fixture();
  try {
    if (reason === "v1") await Bun.write(join(f.proc, "self/cgroup"), "7:memory:/test.scope\n");
    if (reason === "controller") await Bun.write(join(f.service, "cgroup.controllers"), "cpu pids\n");
    if (reason === "writable") await rm(join(f.service, "cgroup.subtree_control"));
    expect(await detectCgroups({ ...f.options, platform: ["darwin", "win32"].includes(reason) ? reason : "linux", dev: reason === "dev" })).toBeUndefined();
    expect(f.logs).toHaveLength(1);
    expect(await Bun.file(join(f.service, "cgroup.procs")).text()).toBe("123\n456\n");
    expect(await Bun.file(join(f.service, "supervisor/cgroup.procs")).exists()).toBe(false);
  } finally { f.cleanup(); }
});

for (const leaf of [false, true]) test(`cgroups set up memory-only subtrees (${leaf ? "DelegateSubgroup" : "old running unit"})`, async () => {
  const f = await fixture(leaf);
  try {
    await mkdir(join(f.service, "pebbles/sample-00000000-0000-0000-0000-000000000000"), { recursive: true });
    await Bun.write(join(f.service, "pebbles/other-owner/keep"), "x");
    const cg = await detectCgroups(f.options);
    expect(cg).toBeDefined();
    expect(f.logs).toEqual([]);
    expect(await Bun.file(join(f.service, "cgroup.subtree_control")).text()).toBe("+memory");
    expect(await Bun.file(join(cg!.root, "cgroup.subtree_control")).text()).toBe("+memory");
    if (!leaf) expect(await Bun.file(join(f.service, "supervisor/cgroup.procs")).text()).toBe("456");
    expect(await Bun.file(join(cg!.root, "other-owner/keep")).exists()).toBe(true);
    expect(await Array.fromAsync(new Bun.Glob("sample-*").scan(cg!.root))).toEqual([]);
    const a = (await cg!.create("sample"))!, b = (await cg!.create("sample"))!;
    expect(a.path).not.toBe(b.path);
    expect(a.path).toMatch(/sample-[a-f0-9-]{36}$/);
    expect(await Bun.file(join(a.path, "memory.high")).text()).toBe(String(4 * 1024 ** 3));
    expect(await Bun.file(join(a.path, "memory.max")).exists()).toBe(false);
    await rm(join(a.path, "memory.high"));
    await cg!.remove(a);
    await expect(rmdir(a.path)).rejects.toThrow();
    expect(await cg!.status()).toEqual(emptyMemory);
    expect(cg!.command(undefined, ["bun", "app.ts"])).toEqual(["bun", "app.ts"]);
  } finally { f.cleanup(); }
});

test("hibernate once per quiet period, swap margin, status and activity during reclaim", async () => {
  const f = await fixture();
  try {
    const cg = (await detectCgroups(f.options))!, a = (await cg.create("sample"))!;
    await Bun.write(join(a.path, "memory.stat"), "anon 157286400\nfile 999999999\n");
    await Bun.write(join(a.path, "memory.current"), "170000000");
    await Bun.write(join(a.path, "memory.swap.current"), "1234");
    await Bun.write(join(a.path, "memory.reclaim"), "untouched");
    expect(await cg.status(a)).toEqual({ resident: 170000000, swapped: 1234, hibernated_at: null });
    await cg.hibernate(a, () => false);
    expect(a.attempted).toBe(false);
    await Bun.write(join(f.proc, "meminfo"), "SwapFree:       400000 kB\n");
    await cg.hibernate(a, () => true);
    expect(a.attempted).toBe(false);
    expect(await Bun.file(join(a.path, "memory.reclaim")).text()).toBe("untouched");
    await Bun.write(join(f.proc, "meminfo"), "SwapFree:       8388608 kB\n");
    await cg.hibernate(a, () => true);
    expect(await Bun.file(join(a.path, "memory.reclaim")).text()).toBe("157286400 swappiness=200");
    expect((await cg.status(a)).hibernated_at).toBeNumber();
    await Bun.write(join(a.path, "memory.reclaim"), "once");
    await cg.hibernate(a, () => true);
    expect(await Bun.file(join(a.path, "memory.reclaim")).text()).toBe("once");
    cg.activity(a);
    expect((await cg.status(a)).hibernated_at).toBeNull();
    let checks = 0;
    await cg.hibernate(a, () => ++checks === 1);
    expect(a.attempted).toBe(false);
    const work = cg.hibernate(a, () => true);
    while (!a.attempted) await Bun.sleep(1);
    cg.activity(a);
    await work;
    expect(a.hibernatedAt).toBeNull();
    await cg.hibernate(a, () => true);
    expect(a.hibernatedAt).toBeNumber();
    await rm(a.path, { recursive: true });
    expect(await cg.status(a)).toEqual(emptyMemory);
  } finally { f.cleanup(); }
});

test.skipIf(process.platform !== "linux")("join-before-exec preserves IPC, environment, PID, exit codes and signals", async () => {
  const temp = tempDirectory();
  try {
    const cg = new PebbleCgroups(temp.dir, "/proc", 1024 ** 3);
    const group = (await cg.create("sample"))!;
    const script = join(temp.dir, "child.ts");
    await Bun.write(script, `process.on("SIGTERM", () => process.exit(42));
process.on("message", m => { if (m === "exit") process.exit(37); process.send!({ echo: m }); });
process.send!({ pid: process.pid, env: process.env.WRAPPER_TEST, joined: (await Bun.file(process.env.PROCS!).text()).trim() });`);
    for (const action of ["exit", "SIGTERM", "SIGKILL"] as const) {
      let ready!: (data: any) => void, reply!: (data: any) => void;
      const first = new Promise<any>(resolve => { ready = resolve; }), second = new Promise<any>(resolve => { reply = resolve; });
      const child = Bun.spawn(cg.command(group, [process.execPath, script]), { env: { ...process.env, WRAPPER_TEST: "preserved", PROCS: join(group.path, "cgroup.procs") }, ipc(data: any) { data.pid ? ready(data) : reply(data); }, stdout: "ignore", stderr: "inherit" });
      try {
        expect(await first).toEqual({ pid: child.pid, env: "preserved", joined: String(child.pid) });
        child.send("ping");
        expect(await second).toEqual({ echo: "ping" });
        if (action === "exit") child.send("exit"); else child.kill(action);
        await child.exited;
        if (action === "SIGKILL") expect(child.signalCode).toBe("SIGKILL");
        else expect(child.exitCode).toBe(action === "exit" ? 37 : 42);
      } finally { child.kill(); await child.exited; }
    }
  } finally { temp.cleanup(); }
}, 10000);

test("reclaim is serialized across children and zero-anon children are skipped", async () => {
  const f = await fixture();
  try {
    const cg = (await detectCgroups(f.options))!, a = (await cg.create("one"))!, b = (await cg.create("two"))!;
    for (const group of [a, b]) {
      await Bun.write(join(group.path, "memory.stat"), "anon 10000000\n");
      await Bun.write(join(group.path, "memory.reclaim"), "");
    }
    await Promise.all([cg.hibernate(a, () => true), cg.hibernate(b, () => true)]);
    expect(a.hibernatedAt).toBeNumber();
    expect(b.attempted).toBe(false);
    await Bun.write(join(b.path, "memory.stat"), "anon 0\nfile 9999999\n");
    await cg.hibernate(b, () => true);
    expect(b.attempted).toBe(false);
    await Bun.write(join(b.path, "memory.stat"), "anon 10000000\n");
    await cg.hibernate(b, () => true);
    expect(b.hibernatedAt).toBeNumber();
  } finally { f.cleanup(); }
});

test("status endpoints return null memory fields when cgroups are off", async () => {
  const { openDaemonDatabase } = await import("./db");
  const { Supervisor } = await import("./supervisor");
  const { Releases } = await import("./releases");
  const { createApi } = await import("./api");
  const temp = tempDirectory(), db = await openDaemonDatabase(temp.dir);
  const supervisor = new Supervisor(temp.dir, db, "test-master");
  try {
    db.save({ name: "sample", release: join(temp.dir, "release"), previous_release: null, status: "stopped" });
    const token = db.createToken();
    const api = createApi(db, new Releases(temp.dir, db, supervisor), supervisor);
    for (const path of ["/api/pebbles", "/api/status"]) {
      const response = await api(new Request("http://localhost" + path, { headers: { authorization: `Bearer ${token}` } }));
      const value = (await response.json()).value;
      expect((path === "/api/status" ? value.pebbles : value)[0].memory).toEqual(emptyMemory);
    }
  } finally { await supervisor.shutdown(); db.close(); temp.cleanup(); }
});
