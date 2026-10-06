import { join } from "node:path";
import { PebbleLogs } from "../daemon/logs";
import { BedrockError } from "../error";

export function cloudflaredBinary() {
  const binary = Bun.which("cloudflared") ?? Bun.which("cloudflared", { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin" });
  if (!binary) throw new BedrockError("CLOUDFLARED_MISSING", "cloudflared is not installed.", process.platform === "darwin" ? "Install cloudflared with: brew install cloudflared" : "Install the cloudflared package from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ for your Linux distribution.");
  return binary;
}
export class TunnelSupervisor {
  private child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;
  private failures = 0;
  private readers = new Set<Promise<unknown>>();
  private logs: PebbleLogs;
  constructor(home: string, private token: string, private binary = cloudflaredBinary, private configFile?: string) {
    this.logs = new PebbleLogs(home, "", 10 * 1024 * 1024, join(home, "logs"), "cloudflared.log");
  }
  status() { return { running: this.child?.exitCode === null, pid: this.child?.exitCode === null ? this.child.pid : null }; }
  start() {
    if (this.stopping || this.child?.exitCode === null) return;
    const started = Date.now();
    try {
      const child = Bun.spawn([this.binary(), "tunnel", "--no-autoupdate", ...(this.configFile ? ["--config", this.configFile] : []), "run"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined, TUNNEL_TOKEN: this.configFile ? undefined : this.token } });
      this.child = child;
      const redact = async (stream: ReadableStream<Uint8Array>) => {
        // Redact across pipe chunks as well as complete log lines.
        const decoder = new TextDecoder();
        let pending = "";
        for await (const chunk of stream) {
          pending += decoder.decode(chunk, { stream: true });
          if (this.token) pending = pending.replaceAll(this.token, "[redacted]");
          const keep = Math.min(pending.length, Math.max(0, this.token.length - 1));
          this.logs.write(new TextEncoder().encode(pending.slice(0, pending.length - keep)));
          pending = pending.slice(pending.length - keep);
        }
        this.logs.write(new TextEncoder().encode(this.token ? (pending + decoder.decode()).replaceAll(this.token, "[redacted]") : pending + decoder.decode()));
      };
      const reading = Promise.all([redact(child.stdout), redact(child.stderr)]);
      this.readers.add(reading);
      void reading.catch(() => {}).finally(() => this.readers.delete(reading));
      void child.exited.then(() => {
        if (this.child === child) this.child = undefined;
        this.failures = Date.now() - started > 30000 ? 0 : this.failures + 1;
        this.retry();
      });
    } catch (cause) {
      // Spawn errors can contain the environment; emit only a fixed repair hint.
      const error = cause instanceof BedrockError && cause.code === "CLOUDFLARED_MISSING" ? cause : new BedrockError("TUNNEL_START_FAILED", "cloudflared could not start; local serving continues.", "Install cloudflared, check executable permissions, and inspect bedrock doctor.");
      this.logs.write(new TextEncoder().encode(JSON.stringify(error.toJSON()) + "\n"));
      this.failures++;
      this.retry();
    }
  }
  private retry() {
    if (!this.stopping) this.timer = setTimeout(() => { this.timer = undefined; this.start(); }, Math.min(30000, 250 * 2 ** Math.min(this.failures, 7)));
  }
  async stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    const child = this.child;
    if (child?.exitCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 3000);
      try { await child.exited; } finally { clearTimeout(timer); }
    }
    await Promise.allSettled(this.readers);
    this.logs.close();
  }
}
