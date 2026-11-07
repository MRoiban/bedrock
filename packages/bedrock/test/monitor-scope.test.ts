import { expect, test } from "bun:test";
import { join } from "node:path";
import { startDaemon } from "../src/daemon";
import { setupAlerts } from "../src/daemon/alerts/config";
import { setup } from "../src/daemon/config";
import { openDaemonDatabase } from "../src/daemon/db";
import { AlertStore } from "../src/daemon/alerts/store";
import { ErrorStore } from "../src/daemon/errors/store";
import { prepareError } from "../src/daemon/errors/prepare";
import { errorEvent } from "../src/errors/model";
import { tempDirectory } from "./helpers";

test("monitor scope allows owner monitoring and refuses management and cross-pebble access", async () => {
  const temp = tempDirectory();
  await setup(temp.dir, "example.test", "creator@example.test", 0);
  const webhook = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ ok: true }) });
  await setupAlerts(temp.dir, "fixture-webhook-secret", webhook.url.href);
  const db = await openDaemonDatabase(temp.dir);
  const alerts = new AlertStore(join(temp.dir, "alerts.sqlite"), "example.test");
  const errors = new ErrorStore(join(temp.dir, "errors.sqlite"));
  const issues: Record<string, string> = {}, fingerprints: Record<string, string> = {};
  let token: string;
  try {
    for (const name of ["bot-one", "private"]) {
      db.save({ name, release: join(temp.dir, "pebbles", name, "releases/r1"), previous_release: null, status: "stopped" });
      const prepared = (await prepareError(temp.dir, name, { ...errorEvent(new Error(`${name}-sample`), "server", "route", "r1"), frames: [] }, "server", []))!;
      issues[name] = errors.write(name, prepared)!.issue;
      alerts.condition(name, "readiness", true);
      fingerprints[name] = alerts.open().find(i => i.pebble === name)!.fingerprint;
      alerts.silence(fingerprints[name]!, Date.now() + 3600000);
      alerts.db.query("INSERT INTO checks VALUES(?,0,0,NULL,?,0)").run(name, Date.now());
      alerts.db.query("INSERT INTO runs(pebble,job,run,state,at,scheduled) VALUES(?,'sync',?,'succeeded',?,?)").run(name, crypto.randomUUID(), Date.now(), Date.now());
    }
    alerts.condition("", "tunnel", true);
    token = db.createToken(undefined, { scope: { pebbles: ["bot-*"], actions: ["monitor"] } });
    await Bun.write(join(temp.dir, "pebbles/bot-one/logs/pebble.log"), "monitor log fixture\n");
    await Bun.write(join(temp.dir, "backup-state.json"), JSON.stringify({ pebbles: { "bot-one": 1234, private: 5678 }, daemon: 9999 }));
  } finally { db.close(); alerts.db.close(); errors.close(); }
  const daemon = await startDaemon({ home: temp.dir });
  const api = (path: string, method = "GET", body?: unknown, signal?: AbortSignal) => fetch(new URL(path, daemon.server.url), { method, headers: { host: "bedrock.example.test", authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ?? null });
  try {
    for (const path of ["/api/status", "/api/pebbles"]) {
      const response = await api(path); expect(response.status).toBe(200);
      const value = (await response.json()).value;
      expect((Array.isArray(value) ? value : value.pebbles).map((p: any) => p.name)).toEqual(["bot-one"]);
      if (path === "/api/status") {
        expect(value.tunnel).toBeUndefined();
        expect(value.pebbles[0].backup).toEqual({ last_success_at: 1234, interval_ms: null });
      }
      expect(JSON.stringify(value)).not.toContain("private");
    }
    for (const path of ["/api/pebbles/bot-one/metrics", "/api/pebbles/bot-one/logs", "/api/jobs/bot-one/history", "/api/pebbles/bot-one/errors", `/api/pebbles/bot-one/errors/${issues["bot-one"]}`]) {
      const response = await api(path); expect(response.status, path).toBe(200); await response.text();
    }
    const controller = new AbortController();
    const followTimeout = setTimeout(() => controller.abort(), 5000);
    const follow = await api("/api/pebbles/bot-one/logs?follow=true", "GET", undefined, controller.signal);
    expect(follow.status).toBe(200); controller.abort(); clearTimeout(followTimeout);
    for (const action of ["resolve", "ignore"]) expect((await api(`/api/pebbles/bot-one/errors/${issues["bot-one"]}/${action}`, "POST")).status).toBe(200);
    const view = (await (await api("/api/alerts")).json()).value;
    expect(view.incidents.map((i: any) => i.pebble)).toEqual(["bot-one"]);
    expect(view.silences.map((s: any) => s.fingerprint)).toEqual([fingerprints["bot-one"]]);
    expect(view.checks.map((c: any) => c.name)).toEqual(["bot-one"]);
    expect(view.outbox).toBeUndefined(); expect(view.pending).toBeUndefined();
    expect((await api("/api/alerts/silence", "POST", { fingerprint: fingerprints["bot-one"], for: "2h" })).status).toBe(200);
    expect((await api("/api/alerts/test", "POST")).status).toBe(200);
    const forbidden: [string, string, unknown?][] = [
      ["/api/deploy?name=bot-one", "POST"],
      ...["start", "stop", "restart", "rollback"].map(action => [`/api/pebbles/bot-one/${action}`, "POST"] as [string, string]),
      ["/api/pebbles/bot-one?confirm=true", "DELETE"],
      ["/api/pebbles/bot-one/secrets", "GET"], ["/api/pebbles/bot-one/secrets", "PUT"],
      ["/api/tokens", "GET"], ["/api/tokens", "POST"], ["/api/tokens/current", "DELETE"],
      ["/api/pebbles/bot-one/service-tokens", "POST"], ["/api/pebbles/bot-one/service-tokens/id", "DELETE"],
      ["/api/backup/run?name=bot-one", "POST"], ["/api/backup/restore?name=bot-one&confirm=true", "POST"], ["/api/backup/ls?name=bot-one", "GET"],
      ["/api/self-update", "POST"], ["/api/pebbles/bot-one/sessions", "POST"],
      ["/api/jobs/bot-one?job=sync", "POST"], ["/api/jobs/bot-one", "GET"], ["/api/config", "GET"],
      [`/api/pebbles/bot-one/errors/${issues["bot-one"]}/merge?confirm=true&target=x`, "POST"],
      ["/api/pebbles/bot-one/errors/transitions", "GET"],
      ["/api/pebbles/bot-one/resources", "GET"], ["/api/pebbles/bot-one/events", "GET"], ["/api/pebbles/bot-one/lifecycle", "GET"],
      ...["metrics", "logs", "logs?follow=true", "errors", `errors/${issues.private}`].map(endpoint => [`/api/pebbles/private/${endpoint}`, "GET"] as [string, string]),
      ["/api/jobs/private/history", "GET"],
      ...["resolve", "ignore"].map(action => [`/api/pebbles/private/errors/${issues.private}/${action}`, "POST"] as [string, string]),
      ["/api/alerts/silence", "POST", { fingerprint: fingerprints.private, for: "2h" }],
      ["/api/alerts/silence", "POST", { fingerprint: JSON.stringify(["example.test", "", "tunnel", ""]), for: "2h" }],
    ];
    for (const [path, method, body] of forbidden) {
      const response = await api(path, method, body);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
    }
    expect((await api(`/api/pebbles/bot-one/errors/${issues.private}`)).status).toBe(404);
  } finally { await daemon.stop(); webhook.stop(true); temp.cleanup(); }
}, 30000);
