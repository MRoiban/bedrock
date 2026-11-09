import { expect, spyOn, test } from "bun:test";
import { join, resolve } from "node:path";
import { startDaemon } from "../src/daemon";
import { createApi, daemonError } from "../src/daemon/api";
import { Releases } from "../src/daemon/releases";
import { Supervisor } from "../src/daemon/supervisor";
import { Telemetry } from "../src/daemon/telemetry";
import { suggestDaemonError } from "../src/daemon/suggestions";
import { BedrockError } from "../src/error";
import { setup } from "../src/daemon/config";
import { openDaemonDatabase } from "../src/daemon/db";
import { createArchive } from "../src/daemon/archive";
import { ErrorStore } from "../src/daemon/errors/store";
import { prepareError } from "../src/daemon/errors/prepare";
import { errorEvent } from "../src/errors/model";
import { backupSetup, createBackups } from "../src/backup";
import { call } from "../src/cli/daemon";
import { tempDirectory } from "./helpers";

test("suggestion listings preserve the original error on lookup failures or denied permissions", async () => {
  const temp = tempDirectory(), db = await openDaemonDatabase(temp.dir);
  const telemetry = new Telemetry(temp.dir, () => [], false);
  const supervisor = new Supervisor(temp.dir, db, "test-master", [], false, temp.dir, undefined, undefined, undefined, undefined, telemetry);
  const releases = new Releases(temp.dir, db, supervisor);
  const backups = createBackups(temp.dir, db, releases);
  const token = db.createToken();
  const api = createApi(db, releases, supervisor, undefined, backups);
  const request = (path: string, method = "GET") => new Request(`http://localhost${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  const preserves = async (original: BedrockError, path: string, method?: string) => {
    const req = request(path, method);
    await expect(api(req)).rejects.toBe(original);
    const actual = await api(req).catch(error => daemonError(error));
    expect(actual.status).toBe(daemonError(original).status);
    expect(await actual.json()).toEqual({ ok: false, error: original.toJSON() });
  };
  try {
    const missing = new BedrockError("PEBBLE_NOT_FOUND", "Unknown pebble: noets", "Deploy the pebble first or use bedrock ls to find its name.");
    const record = spyOn(releases, "record").mockImplementation(() => { throw missing; });
    const list = spyOn(db, "list").mockImplementation(() => { throw new Error("database unavailable"); });
    try { await preserves(missing, "/api/pebbles/noets/logs"); }
    finally { record.mockRestore(); list.mockRestore(); }

    db.save({ name: "notes", release: temp.dir, previous_release: null, status: "stopped" });
    const jobError = new BedrockError("JOB_NOT_FOUND", "Unknown job: nightyl", "List jobs first.");
    const jobs = spyOn(supervisor, "jobs").mockImplementation(async (_pebble, job) => { throw job ? jobError : new Error("child gone"); });
    try {
      await preserves(jobError, "/api/jobs/notes?job=nightyl", "POST");
      jobs.mockClear();
      expect(await suggestDaemonError(jobError, request("/api/jobs/notes?job=nightyl", "POST"), { pebbles: ["*"], actions: ["monitor"] }, db, supervisor, backups)).toBe(jobError);
      expect(jobs).not.toHaveBeenCalled();
    }
    finally { jobs.mockRestore(); }

    const issueError = new BedrockError("NOT_FOUND", "Error issue not found.", "List this pebble's error issues first.");
    const query = spyOn(telemetry.errors, "query").mockRejectedValue(issueError);
    const ids = spyOn(telemetry.errors, "suggestionIds").mockRejectedValue(new Error("worker gone"));
    try { await preserves(issueError, "/api/pebbles/notes/errors/ab"); }
    finally { query.mockRestore(); ids.mockRestore(); }

    const backupError = new BedrockError("BACKUP_NOT_FOUND", "Snapshot not found.", "List backups first.");
    const restore = spyOn(backups, "restore").mockRejectedValue(backupError);
    const snapshots = spyOn(backups, "list").mockRejectedValue(new Error("backup target gone"));
    try {
      const path = "/api/backup/restore?name=notes&at=2026-01-01&confirm=true";
      await preserves(backupError, path, "POST");
      snapshots.mockClear();
      expect(await suggestDaemonError(backupError, request(path, "POST"), { pebbles: ["*"], actions: ["monitor"] }, db, supervisor, backups)).toBe(backupError);
      expect(snapshots).not.toHaveBeenCalled();
    }
    finally { restore.mockRestore(); snapshots.mockRestore(); }
  } finally { await supervisor.shutdown(); await telemetry.close(); db.close(); temp.cleanup(); }
});

test("daemon suggests only visible pebble and issue names, and CLI preserves error data", async () => {
  const temp = tempDirectory();
  await setup(temp.dir, "example.test", "creator@example.test", 0);
  const db = await openDaemonDatabase(temp.dir);
  const errors = new ErrorStore(join(temp.dir, "errors.sqlite"));
  let scoped: string, visible: string, typoOnly: string, logsOnly: string, lifecycleOnly: string, monitor: string, issue: string;
  try {
    for (const name of ["notes", "notes-private"]) db.save({ name, release: join(temp.dir, name), previous_release: null, status: "stopped" });
    scoped = db.createToken(undefined, { scope: { pebbles: ["other*"], actions: ["logs", "status"] } });
    typoOnly = db.createToken(undefined, { scope: { pebbles: ["noets"], actions: ["logs"] } });
    visible = db.createToken(undefined, { scope: { pebbles: ["notes"], actions: ["logs", "status", "lifecycle"] } });
    logsOnly = db.createToken(undefined, { scope: { pebbles: ["*"], actions: ["logs"] } });
    lifecycleOnly = db.createToken(undefined, { scope: { pebbles: ["*"], actions: ["lifecycle"] } });
    monitor = db.createToken(undefined, { scope: { pebbles: ["*"], actions: ["monitor"] } });
    const prepared = (await prepareError(temp.dir, "notes", { ...errorEvent(new Error("sample"), "server", "route", "r1"), frames: [] }, "server", []))!;
    issue = errors.write("notes", prepared)!.issue;
  } finally { db.close(); errors.close(); }
  const daemon = await startDaemon({ home: temp.dir });
  const admin = (await Bun.file(join(temp.dir, "admin-token")).text()).trim();
  const api = (path: string, token = admin, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { authorization: `Bearer ${token}` } });
  try {
    const response = await api("/api/pebbles/noets/logs");
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatchObject({ code: "PEBBLE_NOT_FOUND", data: { unknown: "noets", suggestions: ["notes"] } });
    const forbidden = await api("/api/pebbles/noets/logs", scoped!);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ ok: false, error: { code: "FORBIDDEN", message: "The deploy token scope does not grant this operation.", hint: "Use a creator token or grant logs for pebble noets." } });
    const invisible = await api("/api/pebbles/noets/logs", typoOnly!);
    expect(invisible.status).toBe(404);
    expect(await invisible.json()).toEqual({ ok: false, error: { code: "PEBBLE_NOT_FOUND", message: "Unknown pebble: noets", hint: "Deploy the pebble first or use bedrock ls to find its name." } });
    expect((await api("/api/pebbles", logsOnly!)).status).toBe(403);
    const logsTypo = await api("/api/pebbles/noets/logs", logsOnly!);
    expect(logsTypo.status).toBe(404);
    expect(await logsTypo.json()).toEqual({ ok: false, error: {
      code: "PEBBLE_NOT_FOUND", message: "Unknown pebble: noets", hint: "Deploy the pebble first or use bedrock ls to find its name.",
    } });
    expect((await api("/api/pebbles/notes/errors", lifecycleOnly!)).status).toBe(403);
    for (const suffix of [`${issue!.slice(0, 2)}/resolve`, `${issue!.slice(0, 2)}/ignore`, `${issue!}/merge?confirm=true&target=${issue!.slice(0, 2)}`]) {
      const missing = await api(`/api/pebbles/notes/errors/${suffix}`, lifecycleOnly!, { method: "POST" });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ ok: false, error: suffix.includes("merge") ? {
        code: "NOT_FOUND", message: "Merge target not found.", hint: "Choose another issue in the same pebble.",
      } : {
        code: "NOT_FOUND", message: "Error issue not found.", hint: "List this pebble's error issues first.",
      } });
    }
    expect((await (await api("/api/pebbles/notes-private/logs", visible!)).json()).error.data).toBeUndefined();
    expect((await (await api("/api/pebbles/other-missing/logs", scoped!)).json()).error.data).toBeUndefined();
    expect((await (await api("/api/pebbles/zzzzzzzz/logs")).json()).error.data).toBeUndefined();
    const prefix = issue!.slice(0, 8);
    expect((await (await api(`/api/pebbles/notes/errors/${prefix}`, visible!)).json()).error.data).toEqual({ unknown: prefix, suggestions: [issue!] });
    expect((await (await api("/api/pebbles/noets/logs", monitor!)).json()).error.data).toEqual({ unknown: "noets", suggestions: ["notes"] });
    for (const token of [visible!, monitor!]) {
      expect((await (await api(`/api/pebbles/notes/errors/${prefix}/resolve`, token, { method: "POST" })).json()).error.data).toEqual({ unknown: prefix, suggestions: [issue!] });
    }
    expect((await (await api(`/api/pebbles/notes/errors/${issue!}/merge?confirm=true&target=${prefix}`, visible!, { method: "POST" })).json()).error.data).toEqual({ unknown: prefix, suggestions: [issue!] });
    await expect(call({ "--url": daemon.server.url.origin, "--token": admin }, "/api/pebbles/noets/logs")).rejects.toMatchObject({ data: { unknown: "noets", suggestions: ["notes"] } });
    // These APIs intentionally accept missing identifiers, including secrets staged before deploy.
    expect((await api("/api/pebbles/notes/secrets", admin, { method: "PUT", body: JSON.stringify({ set: { STRIPE_KEY: "never-echo-this" } }) })).status).toBe(200);
    const unset = await api("/api/pebbles/notes/secrets", admin, { method: "PUT", body: JSON.stringify({ unset: ["STRIPE_KYE"] }) });
    expect(await unset.json()).toMatchObject({ ok: true, value: { secrets: [{ name: "STRIPE_KEY" }] } });
    expect((await api(`/api/tokens/${"f".repeat(64)}`, admin, { method: "DELETE" })).status).toBe(200);
    expect((await api("/api/pebbles/missing?confirm=true", admin, { method: "DELETE" })).status).toBe(200);
  } finally { await daemon.stop(); temp.cleanup(); }
}, 30000);

test("daemon suggests jobs and nearest backup timestamps without running the guess", async () => {
  const temp = tempDirectory();
  await setup(temp.dir, "example.test", "creator@example.test", 0);
  await backupSetup(temp.dir, { type: "fs", directory: join(temp.dir, "backups") });
  const daemon = await startDaemon({ home: temp.dir });
  const token = (await Bun.file(join(temp.dir, "admin-token")).text()).trim();
  const api = (path: string, init: RequestInit = {}) => fetch(new URL(path, daemon.server.url), { ...init, headers: { authorization: `Bearer ${token}` } });
  try {
    const source = join(temp.dir, "source");
    await Bun.write(join(source, "pebble.ts"), `import { definePebble, job } from ${JSON.stringify(resolve(import.meta.dir, "../src/config/index.ts"))};
export default definePebble({ name: "notes", jobs: { nightly: job("0 0 31 2 *", () => { throw new Error("must not run"); }) } });`);
    const archive = join(temp.dir, "notes.tar.gz");
    await createArchive(source, archive);
    const deployed = await api("/api/deploy?name=notes", { method: "POST", body: Bun.file(archive) });
    expect(await deployed.json()).toMatchObject({ ok: true });
    const response = await api("/api/jobs/notes?job=nightyl", { method: "POST" });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatchObject({ code: "JOB_NOT_FOUND", data: { unknown: "nightyl", suggestions: ["nightly"] } });
    expect((await (await api("/api/jobs/notes?job=zzzzzzzz", { method: "POST" })).json()).error.data).toBeUndefined();
    const snapshot = (await (await api("/api/backup/run?name=notes", { method: "POST" })).json()).value[0];
    const at = new Date(Date.parse(snapshot.timestamp) + 1000).toISOString();
    const restore = await api(`/api/backup/restore?name=notes&at=${encodeURIComponent(at)}&confirm=true`, { method: "POST" });
    expect(restore.status).toBe(500);
    expect((await restore.json()).error).toMatchObject({ code: "BACKUP_NOT_FOUND", data: { unknown: at, suggestions: [snapshot.timestamp] } });
  } finally { await daemon.stop(); temp.cleanup(); }
}, 30000);
