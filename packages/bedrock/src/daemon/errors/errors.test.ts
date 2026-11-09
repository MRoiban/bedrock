import { ErrorWorker, type ErrorWork } from "./worker";
import { createSecrets } from "../secrets";
import { expect, spyOn, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { ErrorStore } from "./store";
import { ErrorTracking } from "./index";
import { prepareError } from "./prepare";
import { cleanEvent, errorEvent, scrub, stackFrames } from "../../errors/model";
import { tempDirectory } from "../../../test/helpers";

const event = () => ({ ...errorEvent(new TypeError("user x@example.test token=supersecret http://host/private?q=secret 192.168.1.1"), "browser", "unhandled-error", "r1"), frames: [{ file: "/app.js", function: "fail", line: 1, column: 1 }] });
test("issue suggestion IDs use one lightweight query capped at the 200 most recent per pebble", () => {
  const temp = tempDirectory(), store = new ErrorStore(join(temp.dir, "errors.sqlite"));
  try {
    const insert = store.db.query("INSERT INTO issues VALUES(?,?,'server','Error','open',0,?,'r1',0,0,0)");
    store.db.transaction(() => {
      for (let i = 0; i < 251; i++) insert.run(`issue-${i}`, "notes", i);
      insert.run("private-issue", "private", 1000);
    })();
    const query = spyOn(store.db, "query");
    try {
      expect(store.suggestionIds("notes")).toEqual(Array.from({ length: 200 }, (_, i) => `issue-${250 - i}`));
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0]![0]).toStartWith("SELECT id FROM issues");
    } finally { query.mockRestore(); }
    expect(store.suggestionIds("private")).toEqual(["private-issue"]);
    expect(store.suggestionIds("missing")).toEqual([]);
  } finally { store.close(); temp.cleanup(); }
});

test("error protocol scrubs fields, rejects malformed frames and parses browser stacks", () => {
  let reads = 0;
  const unsafe = new Error("safe"); Object.defineProperty(unsafe, "message", { get() { reads++; return "private"; } });
  expect(errorEvent(unsafe, "browser", "unhandled-error", "r1").message).toBe("Error"); expect(reads).toBe(0);
  const e = cleanEvent({ ...event(), cookie: "private" }, "browser")!;
  expect(JSON.stringify(e)).not.toContain("private?q"); expect(e.message).not.toContain("x@example"); expect(e.message).not.toContain("supersecret"); expect(e.message).not.toContain("192.168"); expect(e).not.toHaveProperty("cookie");
  expect(cleanEvent({ ...e, frames: [{ file: "/x", line: -1 }] }, "browser")).toBeNull();
  expect(scrub("secretvalue", ["secretvalue"])).toBe("[REDACTED]");
  expect(scrub("::1 2001:db8::abcd hé@example.test")).toBe("[IP] [IP] [EMAIL]");
  expect(stackFrames("Error: fail\n at throwIt (https://a/b.js:10:4)\nfn@https://a/b.js:12:6")).toHaveLength(2);
});
test("errors group on mapped app frames across releases/messages, regress, merge aliases, quarantine noise", async () => {
  const temp = tempDirectory();
  const store = new ErrorStore(join(temp.dir, "errors.sqlite"));
  try {
    for (const release of ["r1", "r2"]) {
      await Bun.write(join(temp.dir, "pebbles/p/releases", release, ".bedrock-web/manifest.json"), JSON.stringify({ maps: { "/app.js": "maps/app.map" } }));
      await Bun.write(join(temp.dir, "pebbles/p/releases", release, ".bedrock-web/maps/app.map"), JSON.stringify({ version: 3, sources: ["web/app.ts"], names: ["fail"], mappings: "AAEAA" }));
    }
    const first = (await prepareError(temp.dir, "p", event(), "browser", []))!;
    expect(first.frames[0]).toMatchObject({ file: "web/app.ts", line: 3, mapped: true });
    const transition = store.write("p", first)!; expect(transition.kind).toBe("new-issue"); expect(transition.delivery).toBe("digest");
    store.change("p", transition.issue, "resolve");
    const second = (await prepareError(temp.dir, "p", { ...event(), release: "r2", message: "different value" }, "browser", []))!;
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(store.write("p", second)?.kind).toBe("regression");
    expect(store.write("p", second)).toBeNull();
    expect((store.query("p", transition.issue).counts[0] as any).count).toBe(1);
    const other = { ...first, id: crypto.randomUUID(), fingerprint: "v1:other" };
    const otherId = store.write("p", other)!.issue;
    store.change("p", otherId, "merge", transition.issue);
    expect(store.change("p", otherId, "merge", transition.issue).target).toBe(transition.issue);
    expect(store.query("p", transition.issue).fingerprints).toHaveLength(2);
    store.write("p", { ...other, id: crypto.randomUUID() });
    expect(store.query("p").issues).toHaveLength(1);
    store.change("p", transition.issue, "ignore");
    expect(store.write("p", { ...first, id: crypto.randomUUID() })).toBeNull();
    const extension = (await prepareError(temp.dir, "p", { ...event(), frames: [{ file: "chrome-extension://abcd/a.js", function: "x", line: 1, column: 1 }] }, "browser", []))!;
    expect(extension.quarantine).toBe(true); expect(store.write("p", extension)).toBeNull();
    const noise = (await prepareError(temp.dir, "p", { ...event(), message: "ResizeObserver loop limit exceeded", type: "ResizeObserverError" }, "browser", []))!;
    expect(store.write("p", noise)).toBeNull();
    const noiseId = (store.query("p").issues as any[]).find(i => i.noise).id;
    expect(store.query("p", noiseId).samples).toHaveLength(0);
    const missing = (await prepareError(temp.dir, "p", { ...event(), release: "absent" }, "browser", []))!;
    expect(missing.missingMaps).toBe(true);
  } finally { store.close(); temp.cleanup(); }
});
test("payload budget, sample cap, retention and reserved server capacity stay bounded", async () => {
  const temp = tempDirectory(), store = new ErrorStore(join(temp.dir, "errors.sqlite"), 12000);
  try {
    const prepared = (await prepareError(temp.dir, "p", event(), "browser", []))!;
    const now = Date.now();
    for (let i = 0; i < 30; i++) store.write("p", { ...prepared, id: crypto.randomUUID() }, now);
    const page = store.query("p"), issue = (page.issues[0] as any).id;
    expect(page.payload_bytes).toBeLessThanOrEqual(12000);
    expect(page.drops.some((loss: any) => loss.reason === "payload_budget_evicted" && loss.count > 0)).toBe(true);
    expect(store.query("p", issue).samples!.length).toBeLessThanOrEqual(20);
    expect((page.counts[0] as any).count).toBe(30);
    store.maintain(now + 15 * 86400000);
    expect(store.query("p", issue).samples).toHaveLength(0);
    expect(store.query("p", issue).counts).toHaveLength(1);
    store.maintain(now + 91 * 86400000);
    expect(store.query("p").issues).toHaveLength(0);
    const defaultPath = join(temp.dir, "default.sqlite"), defaults = new ErrorStore(defaultPath);
    try {
      for (let i = 0; i < 25; i++) defaults.write("p", { ...prepared, id: crypto.randomUUID() }, now);
      const rows = defaults.query("p");
      expect(rows.payload_budget).toBe(1024 ** 3);
      expect(defaults.query("p", (rows.issues[0] as any).id).samples).toHaveLength(20);
      const pageSize = (defaults.db.query("PRAGMA page_size").get() as any).page_size;
      const maxPages = (defaults.db.query("PRAGMA max_page_count").get() as any).max_page_count;
      expect(maxPages * pageSize).toBe(480 * 1024 ** 2);
      expect(statSync(defaultPath).size + statSync(defaultPath + "-wal").size).toBeLessThan(1024 ** 3);
    } finally { defaults.close(); }
    const tracker = new ErrorTracking(async () => ({ transitions: [] }));
    const bodies = Array.from({ length: 16 }, () => tracker.body()!);
    expect(tracker.body()).toBeNull(); for (const release of bodies) release();
    for (let i = 0; i < 90; i++) expect(tracker.accept("p", [event()], now)).toBeNull();
    expect(tracker.accept("p", [event()], now)).toBe("rate");
    for (let i = 0; i < 30; i++) expect(tracker.accept("p", [{ ...event(), runtime: "server" }], now)).toBeNull();
    expect(tracker.accept("p", [{ ...event(), runtime: "server" }], now)).toBe("rate");
    await tracker.close();
  } finally { store.close(); temp.cleanup(); }
});


test("idle error ingestion loads current secrets without a child and fails closed on unreadable secrets", async () => {
  const temp = tempDirectory(), worker = new ErrorWorker(), secrets = createSecrets(temp.dir);
  const work = (op: string, body: object) => worker.handle(temp.dir, { op, ...body } as ErrorWork, new Map());
  try {
    await secrets.update("p", { set: { KEY: "wxyz" } });
    const first: any = await work("errors.batch", { errorRecords: [{ pebble: "p", event: { ...event(), message: "wxyz" } }] });
    const id = first.transitions[0].issue;
    await secrets.update("p", { set: { KEY: "qrst" } });
    await work("errors.batch", { errorRecords: [{ pebble: "p", event: { ...event(), message: "wxyz qrst" } }] });
    const page: any = await work("errors.query", { pebble: "p", issue: id, cursor: 0 });
    expect(page.samples).toHaveLength(2);
    expect(JSON.stringify(page)).not.toContain("wxyz"); expect(JSON.stringify(page)).not.toContain("qrst");
    expect(page.samples[0].message).toContain("[REDACTED]");
    await Bun.write(join(temp.dir, "pebbles/p/secrets.json"), "{");
    await expect(work("errors.batch", { errorRecords: [{ pebble: "p", event: event() }] })).rejects.toThrow("Could not read pebble secrets");
  } finally { worker.close(); temp.cleanup(); }
});
