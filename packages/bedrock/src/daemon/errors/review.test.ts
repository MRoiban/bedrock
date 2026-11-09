import { expect, test } from "bun:test";
import { join } from "node:path";
import { ErrorStore } from "./store";
import { prepareError } from "./prepare";
import { cleanEvent, errorEvent } from "../../errors/model";
import { tempDirectory } from "../../../test/helpers";

const event = () => errorEvent(new Error("safe"), "browser", "unhandled-error", "r1");

test("R3-1 foreign issue detail and state changes reject without disclosing samples or aliases", async () => {
  const temp = tempDirectory(), store = new ErrorStore(join(temp.dir, "errors.sqlite"));
  try {
    const prepared = (await prepareError(temp.dir, "private", event(), "browser", []))!;
    const privateId = store.write("private", prepared)!.issue;
    const allowedId = store.write("allowed", { ...prepared, id: crypto.randomUUID() })!.issue;
    expect(() => store.query("allowed", privateId)).toThrow("Error issue not found");
    for (const action of ["resolve", "ignore", "merge"]) {
      expect(() => store.change("allowed", privateId, action, allowedId)).toThrow("Error issue not found");
    }
    expect(() => store.change("allowed", allowedId, "merge", privateId)).toThrow("Merge target not found");
    expect(store.query("private", privateId).samples).toHaveLength(1);
    expect(store.query("allowed", allowedId).fingerprints).toHaveLength(1);
    const source = store.write("allowed", { ...prepared, id: crypto.randomUUID(), fingerprint: "other" })!.issue;
    store.change("allowed", source, "merge", allowedId);
    expect(() => store.change("private", source, "merge", allowedId)).toThrow("Error issue not found");
    expect(store.change("allowed", source, "merge", allowedId).target).toBe(allowedId);
  } finally { store.close(); temp.cleanup(); }
});

test("R3-2 client and daemon redact quoted credential keys and complete spaced values", async () => {
  const temp = tempDirectory(), store = new ErrorStore(join(temp.dir, "errors.sqlite"));
  try {
    const fields = { password: "user-password", passwd: "old-pass", secret: "private secret", token: "private token", api_key: "private key", "api-key": "other key", authorization: "Basic private credential", cookie: "session=private; other=hidden", "set-cookie": "session=hidden; HttpOnly", session: "private session", bearer: "private bearer" };
    const messages = [JSON.stringify(fields), Object.entries(fields).map(([key, value]) => `'${key}'='${value}'`).join(","), "authorization=Basic private credential; cookie=session=hidden; other=hidden"];
    for (const message of messages) {
      const captured = errorEvent(new Error(message), "browser", "unhandled-error", "r1");
      const daemon = cleanEvent({ ...event(), message }, "browser")!;
      const prepared = (await prepareError(temp.dir, "p", { ...event(), message }, "browser", []))!;
      store.write("p", prepared);
      const id = store.query("p").issues[0]!.id;
      for (const text of [captured.message, daemon.message, JSON.stringify(store.query("p", id))]) {
        expect(text).not.toMatch(/user-password|old-pass|private|hidden/);
        expect(text).toContain("[REDACTED]");
      }
    }
  } finally { store.close(); temp.cleanup(); }
});

test("R3-4 browser cardinality cannot consume server reserve or another pebble's share", async () => {
  const temp = tempDirectory(), store = new ErrorStore(join(temp.dir, "errors.sqlite"));
  try {
    const prepared = (await prepareError(temp.dir, "public", event(), "browser", []))!;
    const issueStatement = store.db.prepare("INSERT INTO issues VALUES(?,?,?,?,?,?,?,?,?,?,?)"), fingerprintStatement = store.db.prepare("INSERT INTO fingerprints VALUES(?,?,?)");
    const seed = store.db.transaction((pebble: string, runtime: string, count: number) => {
      for (let i = 0; i < count; i++) {
        const id = `${pebble}-${i}`;
        issueStatement.run(id, pebble, runtime, "Error", "open", Date.now(), Date.now(), "r1", 1, 0, 0);
        fingerprintStatement.run(pebble, id, id);
      }
    });
    seed("public", "browser", 1000);
    expect(store.write("public", prepared)).toBeNull();
    expect(store.query("public").drops).toContainEqual({ reason: "browser_issue_budget", count: 1 });
    store.write("public", { ...prepared, id: crypto.randomUUID(), fingerprint: "public-0" });
    expect(store.query("public", "public-0").counts).toHaveLength(1);
    expect(store.write("other", { ...prepared, id: crypto.randomUUID() })?.kind).toBe("new-issue");
    seed("other-browser", "browser", 6999);
    expect(store.write("next", { ...prepared, id: crypto.randomUUID() })).toBeNull();
    expect(store.write("server", { ...prepared, runtime: "server", id: crypto.randomUUID() })?.kind).toBe("new-issue");
  } finally { store.close(); temp.cleanup(); }
});

test("R3-4 inactive metadata and merge aliases expire while recent resolved and ignored issues retain state", async () => {
  const temp = tempDirectory(), store = new ErrorStore(join(temp.dir, "errors.sqlite"));
  try {
    const prepared = (await prepareError(temp.dir, "p", event(), "browser", []))!, now = Date.now(), day = 86400000;
    const stale = store.write("p", prepared, now - 91 * day)!.issue;
    const alias = store.write("p", { ...prepared, fingerprint: "alias", id: crypto.randomUUID() }, now - 91 * day)!.issue;
    store.change("p", alias, "merge", stale);
    const resolved = store.write("p", { ...prepared, fingerprint: "resolved", id: crypto.randomUUID() }, now)!.issue;
    store.change("p", resolved, "resolve");
    const ignored = store.write("p", { ...prepared, fingerprint: "ignored", id: crypto.randomUUID() }, now)!.issue;
    store.change("p", ignored, "ignore");
    store.maintain(now);
    expect(store.db.query("SELECT id FROM issues WHERE id=?").get(stale)).toBeNull();
    for (const table of ["fingerprints", "samples", "counts", "transitions"]) expect(store.db.query(`SELECT 1 FROM ${table} WHERE issue=?`).get(stale)).toBeNull();
    expect(store.db.query("SELECT 1 FROM merges WHERE id=?").get(alias)).toBeNull();
    expect(store.query("p", resolved).issues[0]!.state).toBe("resolved");
    expect(store.query("p", ignored).issues[0]!.state).toBe("ignored");
  } finally { store.close(); temp.cleanup(); }
});
