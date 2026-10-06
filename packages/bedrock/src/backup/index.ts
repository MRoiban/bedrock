import { join, resolve } from "node:path";
import { atomicWrite, readConfig } from "../daemon/config";
import type { DaemonDatabase } from "../daemon/db";
import type { Releases } from "../daemon/releases";
import { BedrockError, asBedrockError } from "../error";
import { fsTarget, r2Target, type BackupTarget } from "./target";
import { manifests, prune, restoreData, snapshot } from "./snapshot";
export { fsTarget, r2Target } from "./target";
export { snapshot, manifests, prune, restoreData } from "./snapshot";
export type { BackupTarget } from "./target";

export type BackupConfig = ({ type: "fs"; directory: string } | { type: "r2"; account: string; bucket: string }) & { intervalMinutes?: number; hourly?: number; daily?: number };
export function validateBackup(config: BackupConfig) {
  const invalid = () => { throw new BedrockError("INVALID_BACKUP_CONFIG", "Invalid backup target or retention settings.", "Use backup setup --dir <path> or complete R2 flags; interval must be positive and retention counts nonnegative with at least one snapshot retained."); };
  if (!config || !["fs", "r2"].includes(config.type)) invalid();
  if (config.type === "fs" && (typeof config.directory !== "string" || !config.directory) || config.type === "r2" && (!/^[a-f0-9]{32}$/.test(config.account) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket))) invalid();
  if (!Number.isFinite(config.intervalMinutes ?? 60) || (config.intervalMinutes ?? 60) <= 0 || !Number.isInteger(config.hourly ?? 24) || !Number.isInteger(config.daily ?? 30) || (config.hourly ?? 24) < 0 || (config.daily ?? 30) < 0 || (config.hourly ?? 24) + (config.daily ?? 30) === 0) invalid();
  return config;
}
export async function backupSetup(home: string, backup: BackupConfig, credentials?: { accessKeyId: string; secretAccessKey: string }) {
  validateBackup(backup);
  const config = await readConfig(home);
  if (backup.type === "r2") {
    if (typeof credentials?.accessKeyId !== "string" || !credentials.accessKeyId || typeof credentials.secretAccessKey !== "string" || !credentials.secretAccessKey) throw new BedrockError("BACKUP_CREDENTIALS_MISSING", "R2 credentials are required.", "Pass an access key ID and secret key to backup setup.");
    await atomicWrite(join(home, "backup-credentials"), JSON.stringify(credentials) + "\n");
  }
  config.backup = backup.type === "fs" ? { ...backup, directory: resolve(backup.directory) } : backup;
  await atomicWrite(join(home, "config.json"), JSON.stringify(config, null, 2) + "\n");
  return { configured: true, target: config.backup, hint: "The daemon reads these settings on its next backup check (within one minute)." };
}
async function configuredTarget(home: string) {
  const config = (await readConfig(home)).backup;
  if (!config) throw new BedrockError("BACKUP_NOT_CONFIGURED", "No backup target is configured.", "Run bedrock backup setup --dir <path> or use the R2 flags.");
  validateBackup(config);
  if (config.type === "fs") return { config, target: fsTarget(config.directory) };
  const credentials = await Bun.file(join(home, "backup-credentials")).json().catch(() => null);
  if (typeof credentials?.accessKeyId !== "string" || !credentials.accessKeyId || typeof credentials.secretAccessKey !== "string" || !credentials.secretAccessKey) throw new BedrockError("BACKUP_CREDENTIALS_MISSING", "R2 credentials are missing.", "Repeat bedrock backup setup on this server.");
  return { config, target: r2Target({ ...config, ...credentials }) };
}

export function createBackups(home: string, db: DaemonDatabase, releases: Releases, targetOverride?: BackupTarget) {
  let active: Promise<unknown> | undefined;
  let stopping = false;
  let lastAttempt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  async function exclusive<T>(action: () => Promise<T>) {
    if (stopping || active) throw new BedrockError("BACKUP_BUSY", "A backup operation is running or shutting down.", "Wait for it to finish, then retry.");
    const work = Promise.resolve().then(action);
    active = work;
    try { return await work; } catch (error) { throw asBedrockError(error, "BACKUP_FAILED", "Check the backup target, credentials, disk space, and daemon logs."); }
    finally { active = undefined; }
  }
  const target = async () => targetOverride ? { config: { hourly: 24, daily: 30 }, target: targetOverride } : configuredTarget(home);
  async function run(name?: string) {
    return exclusive(async () => {
      const { config, target: destination } = await target();
      const result = [];
      const names = name ? [name] : db.list().map(record => record.name);
      for (const pebble of names) {
        releases.record(pebble);
        result.push(await releases.exclusive(pebble, async () => {
          const data = join(home, "pebbles", pebble, "data");
          const value = await snapshot(destination, pebble, join(data, "db.sqlite"), join(data, "files"));
          await prune(destination, pebble, config.hourly, config.daily);
          return value;
        }));
      }
      result.push(await snapshot(destination, "_daemon", join(home, "bedrock.sqlite")));
      await prune(destination, "_daemon", config.hourly, config.daily);
      const statePath = join(home, "backup-state.json");
      const state = await Bun.file(statePath).json().catch(() => ({ pebbles: {} }));
      state.pebbles ??= {};
      for (const pebble of names) state.pebbles[pebble] = Date.now();
      state.daemon = Date.now();
      state.lastSuccess = Date.now();
      if (!name) state.lastFullSuccess = state.lastSuccess;
      await atomicWrite(statePath, JSON.stringify(state) + "\n");
      return result;
    });
  }
  return {
    run,
    async list(name: string) { if (name !== "_daemon") releases.record(name); return (await manifests((await target()).target, name)).map(entry => entry.manifest).sort((a, b) => b.timestamp.localeCompare(a.timestamp)); },
    async restore(name: string, at?: string) {
      return exclusive(() => releases.exclusive(name, async () => {
        const record = releases.record(name);
        const destination = (await target()).target;
        await releases.supervisor.stop(name);
        let result;
        try { result = await restoreData(destination, name, join(home, "pebbles", name, "data"), at); }
        finally { await releases.supervisor.start(record); }
        return result;
      }));
    },
    start() {
      async function tick() {
        if (stopping || active) return;
        const config = (await readConfig(home)).backup;
        if (!config) return;
        const state = await Bun.file(join(home, "backup-state.json")).json().catch(() => null);
        if (Date.now() - Math.max(state?.lastFullSuccess ?? 0, lastAttempt) < (config.intervalMinutes ?? 60) * 60000) return;
        lastAttempt = Date.now();
        await run();
      }
      const check = () => { void tick().catch(error => console.error("Backup failed", asBedrockError(error).toJSON())); };
      timer = setInterval(check, 60000); timer.unref(); check();
    },
    async stop() { stopping = true; clearInterval(timer); await active?.catch(() => {}); },
  };
}
