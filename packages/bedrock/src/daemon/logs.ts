import { appendFileSync, mkdirSync, renameSync, statSync, existsSync, rmSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import type { Telemetry } from "./telemetry";
import { isDiskFull } from "../error";
import { dirname, join } from "node:path";

const MIN_SECRET_LENGTH = 8;
const MAX_PENDING_LINE = 64 * 1024;

export class PebbleLogs {
  readonly path: string;
  private secrets = new Set<string>();
  // Short values such as "300" or "true" would mangle ordinary log text, so they are not redacted.
  protect(values: string[]) {
    for (const value of values) if (value.length >= MIN_SECRET_LENGTH) { this.secrets.add(value); this.secrets.add(JSON.stringify(value).slice(1, -1)); }
    this.telemetry?.store.protect(this.telemetry.name, [...this.secrets].sort((a, b) => b.length - a.length));
  }
  redact(value: string) {
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) value = value.replaceAll(secret, "[REDACTED]");
    return value;
  }
  private listeners = new Set<(chunk: Uint8Array) => void>();
  private followers = new Set<() => void>();
  private lineStart = true;
  private retryAt = 0;
  // cloudflared stamps its own lines and is pumped in arbitrary chunks, so it opts out.
  constructor(home: string, name: string, private limit = 10 * 1024 * 1024, directory?: string, filename = "pebble.log", private timestamps = true, private append = appendFileSync, private now = Date.now, private telemetry?: { store: Telemetry; name: string }) {
    const dir = directory ?? join(home, "pebbles", name, "logs");
    try { if (!telemetry) mkdirSync(dir, { recursive: true }); }
    catch (error) { if (!isDiskFull(error)) throw error; }
    this.path = join(dir, filename);
  }
  private stamp(text: string) {
    const time = `${new Date().toISOString()} `;
    let stamped = "";
    for (const line of text.split(/(?<=\n)/)) {
      if (!line) continue;
      stamped += (this.lineStart ? time : "") + line;
      this.lineStart = line.endsWith("\n");
    }
    return stamped;
  }
  write(chunk: Uint8Array, stream = "stdout", run = "") {
    if (this.telemetry) {
      const text = this.redact(new TextDecoder().decode(chunk));
      const lines = text.split("\n"); if (lines.at(-1) === "") lines.pop();
      for (const line of lines) {
        const accepted = this.telemetry.store.log(this.telemetry.name, line, stream, run);
        if (accepted === false) continue;
        const stamped = new TextEncoder().encode(`${new Date().toISOString()} ${accepted}\n`);
        for (const listener of this.listeners) listener(stamped);
      }
      return;
    }
    if (this.secrets.size || this.timestamps) {
      const text = this.redact(new TextDecoder().decode(chunk));
      chunk = new TextEncoder().encode(this.timestamps ? this.stamp(text) : text);
    }
    if (this.now() < this.retryAt) return;
    try {
      if (!existsSync(dirname(this.path))) mkdirSync(dirname(this.path), { recursive: true });
      // Split oversized chunks so a noisy child cannot bypass rotation.
      for (let offset = 0; offset < chunk.length; offset += this.limit) {
        const part = chunk.subarray(offset, offset + this.limit);
        if (existsSync(this.path) && statSync(this.path).size + part.length > this.limit) {
          rmSync(`${this.path}.3`, { force: true });
          for (let i = 2; i >= 0; i--) {
            const source = i ? `${this.path}.${i}` : this.path;
            if (existsSync(source)) renameSync(source, `${this.path}.${i + 1}`);
          }
        }
        this.append(this.path, part);
        for (const listener of this.listeners) listener(part);
      }
      this.retryAt = 0;
    } catch (error) {
      if (!isDiskFull(error)) throw error;
      if (!this.retryAt) console.error(`DISK_FULL: dropping logs for ${this.path}; free disk space or quota. Retrying once a minute.`);
      this.retryAt = this.now() + 60000;
    }
  }
  private async pumpTelemetry(stream: ReadableStream<Uint8Array>, source: string, run: string) {
    const decoder = new TextDecoder();
    let pending = "", truncated = false, lastYield = performance.now();
    const consume = (text: string) => {
      const parts = text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (!truncated) {
          pending += parts[i]!;
          if (Buffer.byteLength(pending) > MAX_PENDING_LINE) { pending = Buffer.from(pending).subarray(0, MAX_PENDING_LINE).toString("utf8"); truncated = true; }
        }
        if (i < parts.length - 1) { this.write(new TextEncoder().encode(pending + "\n"), source, run); pending = ""; truncated = false; }
      }
    };
    for await (const chunk of stream) {
      consume(decoder.decode(chunk, { stream: true }));
      if (performance.now() - lastYield >= 4) { await Bun.sleep(1); lastYield = performance.now(); }
    }
    consume(decoder.decode());
    if (pending) this.write(new TextEncoder().encode(pending), source, run);
  }
  async pump(stream: ReadableStream<Uint8Array>, source = "stdout", run = "") {
    if (this.telemetry) return this.pumpTelemetry(stream, source, run);
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of stream) {
      pending += decoder.decode(chunk, { stream: true });
      pending = this.redact(pending);
      // Whole lines keep timestamps at line starts and stop stdout and stderr interleaving mid-line.
      let boundary = pending.length > MAX_PENDING_LINE ? pending.length : pending.lastIndexOf("\n") + 1;
      // Only retain a suffix that could become a secret in the next pipe chunk.
      for (const secret of this.secrets) {
        for (let length = Math.min(secret.length - 1, pending.length); length > 0; length--) {
          if (pending.endsWith(secret.slice(0, length))) { boundary = Math.min(boundary, pending.length - length); break; }
        }
      }
      if (boundary) { this.write(new TextEncoder().encode(pending.slice(0, boundary)), source, run); pending = pending.slice(boundary); }
    }
    pending += decoder.decode();
    if (pending) this.write(new TextEncoder().encode(pending), source, run);
  }
  tail(lines = 100) {
    if (this.telemetry) return [3, 2, 1, 0].map(index => this.tailFile(index ? `${this.path}.${index}` : this.path, lines)).join("").split("\n").slice(-lines - 1).join("\n");
    return this.tailFile(this.path, lines);
  }
  private tailFile(path: string, lines: number) {
    if (!existsSync(path)) return "";
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
      readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      return this.redact(buffer.toString("utf8")).split("\n").slice(-lines - 1).join("\n");
    } finally { closeSync(fd); }
  }
  private async history() {
    const legacy = this.tail();
    if (!this.telemetry) return legacy;
    const page = await this.telemetry.store.query({ kind: "logs", pebble: this.telemetry.name, from: Date.now() - 7 * 86400_000, to: Date.now(), step: 0, limit: 100 }).catch(() => null);
    return legacy + (page?.rows ?? []).reverse().map((row: { time: number; text: string }) => `${new Date(row.time).toISOString()} ${this.redact(row.text)}\n`).join("");
  }
  async response(follow: boolean, signal: AbortSignal) {
    const history = await this.history();
    if (!follow) return new Response(history, { headers: { "content-type": "text/plain" } });
    const encoder = new TextEncoder();
    let cleanup = () => {};
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        const listener = (chunk: Uint8Array) => {
          if (closed) return;
          if ((controller.desiredSize ?? 0) < -1024 * 1024) { close(); return; }
          controller.enqueue(chunk);
        };
        const close = () => {
          if (closed) return;
          closed = true;
          cleanup();
          controller.close();
        };
        cleanup = () => {
          this.listeners.delete(listener);
          this.followers.delete(close);
          signal.removeEventListener("abort", close);
        };
        this.listeners.add(listener);
        this.followers.add(close);
        signal.addEventListener("abort", close, { once: true });
        try {
          const tail = history;
          if (closed) return;
          controller.enqueue(encoder.encode(tail));
          if (signal.aborted) close();
        } catch (error) {
          if (!closed) { closed = true; cleanup(); controller.error(error); }
        }
      },
      cancel: () => { closed = true; cleanup(); },
    }, { highWaterMark: 256 * 1024, size: chunk => chunk?.byteLength ?? 0 });
    return new Response(stream, { headers: { "content-type": "text/plain", "cache-control": "no-cache" } });
  }
  close() { for (const close of this.followers) close(); }
}
