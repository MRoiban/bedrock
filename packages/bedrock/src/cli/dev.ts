import { watch } from "node:fs";
import { join } from "node:path";
import { startPebble } from "../runtime";
import { asBedrockError } from "../error";

export async function devWorker() {
  const running = await startPebble({ dir: process.cwd(), dataDir: join(process.cwd(), ".bedrock"), port: Number(process.env.BEDROCK_DEV_PORT ?? 3000) });
  process.send?.({ url: running.server.url.toString(), name: running.pebble.name });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await running.stop();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

export async function dev(json: boolean, port: number) {
  let child: Bun.Subprocess;
  let stopped = false;
  let printed = false;
  let restarting = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const launch = () => Bun.spawn([process.execPath, join(import.meta.dir, "index.ts"), "__dev_worker"], {
    cwd: process.cwd(),
    env: { ...process.env, BEDROCK_INSECURE_DEV_USER: "1", BEDROCK_DEV_PORT: String(port) },
    stdin: "inherit", stdout: 2, stderr: "inherit",
    ipc(message: unknown) {
      const value = message as { url: string; name: string; error?: { code: string; message: string; hint: string } };
      if (value.error) {
        if (json && !printed) console.log(JSON.stringify({ ok: false, error: value.error }));
        else console.error(`${value.error.code}: ${value.error.message}\nHint: ${value.error.hint}`);
        return;
      }
      if (!printed) {
        console.log(json ? JSON.stringify({ ok: true, command: "dev", ...value }) : `Bedrock ${value.name}: ${value.url}`);
        printed = true;
      } else console.error(`Restarted ${value.name}: ${value.url}`);
    },
    onExit(_child, code) {
      if (!printed && code !== 0 && !stopped && !restarting) {
        stopped = true;
        watcher.close();
        clearTimeout(timer);
        process.exitCode = 1;
      }
    },
  });
  const restart = async () => {
    if (restarting || stopped) return;
    restarting = true;
    do {
      dirty = false;
      child.kill("SIGTERM");
      await child.exited;
      if (!stopped) child = launch();
    } while (dirty && !stopped);
    restarting = false;
  };
  const watcher = watch(process.cwd(), { recursive: true }, (_event, filename) => {
    if (!filename || filename.split(/[\\/]/).some(part => part === "node_modules" || part === ".git" || part.startsWith(".bedrock"))) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => { void restart().catch(error => console.error(asBedrockError(error).toJSON())); }, 100);
  });
  child = launch();
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    watcher.close();
    clearTimeout(timer);
    child.kill("SIGTERM");
    await child.exited;
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
