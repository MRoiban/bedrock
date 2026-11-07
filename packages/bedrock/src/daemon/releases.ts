import { createSecrets } from "./secrets";
import { buildReleaseWeb } from "./web-build";
import { requireSpace } from "../disk";
import { decodeProvenance, provenanceFile } from "./provenance";
import { assertRollbackSafe } from "./rollback";
import { mkdir, readdir, rename, rm, symlink } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { BedrockError, asBedrockError } from "../error";
import { extract, installRelease } from "./archive";
import type { DaemonDatabase, PebbleRecord } from "./db";
import { pebbleDataDir } from "./config";
import { Supervisor, stopChild, retireChild, type Child } from "./supervisor";

export class Releases {
  private busy = new Map<string, Promise<unknown>>();
  private stopping = false;
  constructor(readonly home: string, readonly db: DaemonDatabase, readonly supervisor: Supervisor) {}
  async exclusive<T>(name: string, action: () => Promise<T>): Promise<T> {
    if (this.stopping) throw new BedrockError("DAEMON_STOPPING", "The daemon is stopping.", "Restart the daemon and retry.");
    if (this.busy.has(name)) throw new BedrockError("PEBBLE_BUSY", `${name} already has an operation in progress.`, "Wait for the operation to finish, then retry.");
    const work = Promise.resolve().then(action);
    this.busy.set(name, work);
    try { return await work; } finally { this.busy.delete(name); }
  }
  record(name: string) {
    const record = this.db.get(name);
    if (!record) throw new BedrockError("PEBBLE_NOT_FOUND", `Unknown pebble: ${name}`, "Deploy the pebble first or use bedrock ls to find its name.");
    return record;
  }
  private async switch(name: string, child: Child, previous: PebbleRecord | null) {
    const root = join(this.home, "pebbles", name);
    const temporary = join(root, `current.${crypto.randomUUID()}`);
    let old: Child | undefined;
    await this.link(child.release, temporary);
    try {
      if (child.process.exitCode !== null) throw new BedrockError("HEALTH_FAILED", "Candidate exited before activation.", `Check bedrock logs ${name} and retry.`);
      await this.replaceCurrent(temporary, root);
      try { this.db.save({ name, release: child.release, previous_release: previous?.release ?? null, status: "running" }); }
      catch (error) {
        if (previous) { await this.link(previous.release, temporary); await this.replaceCurrent(temporary, root); }
        else await rm(join(root, "current"), { force: true });
        throw error;
      }
      old = this.supervisor.child(name);
      this.supervisor.activate(name, child);
      this.supervisor.telemetry?.lifecycle(name, "deploy", child.releaseId);
    } finally { await rm(temporary, { force: true }); }
    if (old) await retireChild(old).catch(error => this.warn(name, error));
    return this.supervisor.startExclusive(name, child);
  }
  // A relative link survives moving BEDROCK_HOME; Windows junctions must be absolute.
  private async link(release: string, path: string) {
    if (process.platform === "win32") await symlink(release, path, "junction");
    else await symlink(relative(join(path, ".."), release), path, "dir");
  }
  private async replaceCurrent(temporary: string, root: string) {
    const current = join(root, "current");
    if (process.platform !== "win32") { await rename(temporary, current); return; }
    // Windows cannot rename over a junction; routing still uses the live child.
    const old = join(root, `current.old-${crypto.randomUUID()}`);
    let moved = false;
    try { await rename(current, old); moved = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try { await rename(temporary, current); }
    catch (error) { if (moved) await rename(old, current); throw error; }
    if (moved) await rm(old, { recursive: true, force: true });
  }
  async deploy(name: string, request: Request) {
    return this.exclusive(name, async () => {
      const root = join(this.home, "pebbles", name);
      const release = join(root, "releases", `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
      const archive = join(root, `upload-${crypto.randomUUID()}.tar.gz`);
      let child: Child | undefined;
      let activated = false;
      try {
        const length = Number(request.headers.get("content-length"));
        await requireSpace(this.home, Number.isFinite(length) && length > 0 ? length : 0);
        await mkdir(root, { recursive: true });
        if (!request.body) throw new BedrockError("INVALID_ARCHIVE", "Deploy body is empty.", "Upload a tar.gz containing pebble.ts at its root.");
        await Bun.write(archive, new Response(request.body));
        await extract(archive, release);
        await Bun.write(join(release, provenanceFile), JSON.stringify(decodeProvenance(request.headers.get("x-bedrock-provenance"))));
        await installRelease(release);
        const secrets = await createSecrets(this.home).env(name);
        const logs = this.supervisor.logs(name);
        logs.protect(Object.values(secrets));
        await buildReleaseWeb(release, { ...secrets, BEDROCK_HOME: this.home,
          BEDROCK_DATA: pebbleDataDir(this.supervisor.dataRoot, name), BEDROCK_RELEASE_ID: basename(release),
          BEDROCK_API_URL: this.supervisor.apiUrl }, value => logs.redact(value));
        child = await this.supervisor.launch(name, release);
        const exclusive_services = await this.switch(name, child, this.db.get(name));
        activated = true;
        await this.prune(name).catch(error => this.warn(name, error));
        return { ...this.db.get(name)!, public_routes: child.publicRoutes, exclusive_services };
      } catch (error) {
        if (!activated) {
          if (child) await stopChild(child);
          await rm(release, { recursive: true, force: true });
        }
        throw asBedrockError(error, "DEPLOY_FAILED", `Check bedrock logs ${name}, fix the archive or dependencies, and redeploy. The previous release is still selected.`, root);
      } finally { await rm(archive, { force: true }); }
    });
  }
  async rollback(name: string, force = false) {
    return this.exclusive(name, async () => {
      const record = this.record(name);
      if (!record.previous_release) throw new BedrockError("NO_PREVIOUS_RELEASE", "There is no previous release to roll back to.", "Deploy another release first.");
      if (!force) await assertRollbackSafe(join(pebbleDataDir(this.supervisor.dataRoot, name), "db.sqlite"), record.previous_release);
      const child = await this.supervisor.launch(name, record.previous_release);
      let exclusive_services;
      try { exclusive_services = await this.switch(name, child, record); }
      catch (error) { await stopChild(child); throw error; }
      return { ...this.record(name), exclusive_services };
    });
  }
  // Same code, new environment: retain routing to the old child until health succeeds.
  async restart(name: string) {
    const record = this.record(name);
    const child = await this.supervisor.launch(name, record.release, this.supervisor.child(name)?.devSource);
    const old = this.supervisor.child(name);
    try { this.supervisor.activate(name, child); this.db.status(name, "running"); }
    catch (error) { await stopChild(child); throw error; }
    if (old) await retireChild(old).catch(error => this.warn(name, error));
    const exclusive_services = await this.supervisor.startExclusive(name, child);
    return { ...this.record(name), exclusive_services };
  }
  async control(name: string, action: string) {
    return this.exclusive(name, async () => {
      const record = this.record(name);
      if (action === "restart") return this.restart(name);
      if (action === "stop") await this.supervisor.stop(name);
      if (action === "start") await this.supervisor.start(record);
      return this.record(name);
    });
  }
  async delete(name: string) {
    return this.exclusive(name, async () => {
      this.record(name);
      await this.supervisor.stop(name);
      await rm(join(this.home, "pebbles", name), { recursive: true, force: true });
      await rm(join(this.supervisor.dataRoot, "pebbles", name), { recursive: true, force: true });
      this.db.remove(name);
      this.supervisor.forget(name);
      return { name, deleted: true };
    });
  }
  private warn(name: string, error: unknown) {
    this.supervisor.logs(name).write(new TextEncoder().encode(JSON.stringify(asBedrockError(error).toJSON()) + "\n"));
  }
  private async prune(name: string) {
    const record = this.record(name);
    const dir = join(this.home, "pebbles", name, "releases");
    const releases = (await readdir(dir)).sort().reverse();
    const keep = new Set([record.release, record.previous_release].filter(Boolean));
    for (const release of releases) {
      const path = join(dir, release);
      if (keep.has(path)) continue;
      if (keep.size < 3) keep.add(path);
      else await rm(path, { recursive: true, force: true });
    }
  }
  async shutdown() { this.stopping = true; await Promise.allSettled(this.busy.values()); }
}
