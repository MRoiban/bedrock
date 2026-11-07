import { watch } from "node:fs";
import { join } from "node:path";
import { BedrockError, asBedrockError } from "../error";

export interface DevOptions {
  dir: string;
  home: string;
  dataDir?: string;
  port: number;
  watch: boolean;
  cron: boolean;
}
interface Ready { url: string; name: string }
interface Message extends Partial<Ready> { requestId?: string; value?: unknown; error?: { code: string; message: string; hint: string } }

export async function launchDev(options: DevOptions, restarted?: (url: string) => void) {
  let stopped = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  const requests = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  const launch = () => {
    let ready!: (value: Ready) => void;
    let failed!: (error: unknown) => void;
    const readiness = new Promise<Ready>((resolve, reject) => { ready = resolve; failed = reject; });
    const worker = Bun.spawn([process.execPath, join(import.meta.dir, "index.ts"), "__dev_worker"], {
      cwd: options.dir, env: { ...process.env, BEDROCK_DEV_OPTIONS: JSON.stringify(options) },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
      ipc(raw) {
        const message = raw as Message;
        const error = message.error && new BedrockError(message.error.code, message.error.message, message.error.hint);
        if (message.requestId) {
          const request = requests.get(message.requestId);
          requests.delete(message.requestId);
          if (error) request?.reject(error); else request?.resolve(message.value);
        } else if (error) failed(error);
        else if (message.url && message.name) ready({ url: message.url, name: message.name });
      },
      onExit() {
        const error = new BedrockError("DEV_STOPPED", "The development worker exited.", "Check its startup logs and retry.");
        failed(error);
        for (const request of requests.values()) request.reject(error);
        requests.clear();
      },
    });
    const forward = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) process.stderr.write(chunk); };
    void Promise.all([forward(worker.stdout), forward(worker.stderr)]).catch(error => console.error(asBedrockError(error).toJSON()));
    const stop = async () => {
      if (worker.exitCode === null) { try { worker.send({ op: "stop" }); } catch { worker.kill(); } }
      const timeout = setTimeout(() => { if (worker.exitCode === null) worker.kill("SIGKILL"); }, 5000);
      try { await worker.exited; } finally { clearTimeout(timeout); }
    };
    const deadline = setTimeout(() => failed(new BedrockError("DEV_START_TIMEOUT", "Development startup exceeded 60 seconds.", "Check service startup and migrations.")), 60_000);
    return { worker, stop, ready: readiness.finally(() => clearTimeout(deadline)) };
  };
  let current = launch();
  let value: Ready;
  try { value = await current.ready; } catch (error) { await current.stop(); throw error; }
  const restart = async () => {
    do {
      dirty = false;
      await current.stop();
      if (!stopped) {
        current = launch();
        try { value = await current.ready; } catch (error) { await current.stop(); throw error; }
        restarted?.(value.url);
      }
    } while (dirty && !stopped);
  };
  const watcher = options.watch ? watch(options.dir, { recursive: true }, (_event, filename) => {
    if (!filename || filename.split(/[\\/]/).some(part => part === "node_modules" || part === ".git" || part.startsWith(".bedrock"))) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!pending) pending = restart().catch(error => console.error(asBedrockError(error).toJSON())).finally(() => { pending = undefined; });
    }, 100);
  }) : undefined;
  return {
    ...value,
    async runJob(name: string) {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { requests.get(requestId)?.reject(new BedrockError("JOB_TIMEOUT", "Test job exceeded 60 seconds.", "Check the job and its external substitutes.")); requests.delete(requestId); }, 60_000);
      try {
        return await new Promise((resolve, reject) => {
          requests.set(requestId, { resolve, reject });
          try { current.worker.send({ op: "job", name, requestId }); } catch (error) { requests.delete(requestId); reject(error); }
        });
      } finally { clearTimeout(timeout); }
    },
    async stop() {
      stopped = true;
      watcher?.close();
      clearTimeout(timer);
      await pending;
      await current.stop();
    },
  };
}

export const devDefaults = (dir: string, port: number): DevOptions => ({ dir, home: join(dir, ".bedrock", "daemon"), port, watch: true, cron: true });
