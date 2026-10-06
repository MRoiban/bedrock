import { watch } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../daemon";
import { loadPebble } from "../runtime/load";
import { asBedrockError } from "../error";

export async function devWorker() {
  const pebble = await loadPebble(process.cwd());
  const running = await startDaemon({ home: join(process.cwd(), ".bedrock", "daemon"), domain: "localhost", dev: true,
    devPebble: { name: pebble.name, dir: process.cwd() }, port: Number(process.env.BEDROCK_DEV_PORT ?? 3000) });
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
  process.on("message", message => { if ((message as { op?: string })?.op === "stop") void stop(); });
  process.on("disconnect", stop);
}

export async function dev(json: boolean, port: number) {
  let child: Bun.Subprocess;
  let stopped = false;
  let printed = false;
  let restarting = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const launch = () => {
    const worker = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts"), "__dev_worker"], {
      cwd: process.cwd(),
      env: { ...process.env, BEDROCK_DEV_PORT: String(port) },
      stdin: "inherit", stdout: "pipe", stderr: "pipe",
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
    const forward = async (stream: ReadableStream<Uint8Array>) => {
      for await (const chunk of stream) process.stderr.write(chunk);
    };
    void Promise.all([forward(worker.stdout), forward(worker.stderr)]).catch(error => console.error(asBedrockError(error).toJSON()));
    return worker;
  };
  const stopWorker = async () => {
    if (child.exitCode === null) {
      try { child.send({ op: "stop" }); } catch { child.kill(); }
    }
    const timeout = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 5000);
    try { await child.exited; } finally { clearTimeout(timeout); }
  };
  const restart = async () => {
    if (restarting || stopped) return;
    restarting = true;
    do {
      dirty = false;
      await stopWorker();
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
    await stopWorker();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
