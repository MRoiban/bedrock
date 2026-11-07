import { join } from "node:path";
import { startDaemon } from "../daemon";
import { loadPebble } from "../runtime/load";
import { asBedrockError } from "../error";
import { launchDev, devDefaults, type DevOptions } from "./dev-launcher";

export async function devWorker() {
  const options: DevOptions = process.env.BEDROCK_DEV_OPTIONS ? JSON.parse(process.env.BEDROCK_DEV_OPTIONS) : devDefaults(process.cwd(), Number(process.env.BEDROCK_DEV_PORT ?? 3000));
  const pebble = await loadPebble(options.dir);
  const running = await startDaemon({ home: options.home, domain: "localhost", dev: true,
    devPebble: { name: pebble.name, dir: options.dir, cron: options.cron, ...(options.dataDir ? { dataDir: options.dataDir } : {}) }, port: options.port });
  process.send?.({ url: `http://${pebble.name}.localhost:${running.server.port}/`, name: pebble.name });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await running.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("message", raw => {
    const message = raw as { op?: string; name?: string; requestId?: string };
    if (message.op === "stop") void stop();
    else if (message.op === "job") void running.runDevJob(message.name!).then(
      value => process.send?.({ requestId: message.requestId, value }),
      error => process.send?.({ requestId: message.requestId, error: asBedrockError(error).toJSON() }),
    );
  });
  process.on("disconnect", stop);
}

const MIGRATION_WARNINGS = new Set(["SCHEMA_DRIFT", "MIGRATION_REPLAY_FAILED", "MIGRATION_AMBIGUOUS"]);

// A separate process: drizzle-kit mutes stdout while it diffs, which would swallow the pebble's own logs.
async function warnOnMigrationDrift() {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts"), "db", "check", "--json"], { cwd: process.cwd(), stdout: "pipe", stderr: "ignore" });
  const output = await new Response(child.stdout).text();
  let result: { ok: boolean; error?: { code: string; message: string; hint: string } };
  try { result = JSON.parse(output); } catch { return; }
  if (result.error && MIGRATION_WARNINGS.has(result.error.code)) console.error(`Warning: ${result.error.code}: ${result.error.message}\nHint: ${result.error.hint}`);
}

export async function dev(json: boolean, port: number) {
  const running = await launchDev(devDefaults(process.cwd(), port), url => console.error(`Restarted ${new URL(url).hostname.split(".")[0]}: ${url}`));
  console.log(json ? JSON.stringify({ ok: true, command: "dev", url: running.url, name: running.name }) : `Bedrock ${running.name}: ${running.url}`);
  void warnOnMigrationDrift().catch(() => {});
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await running.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
