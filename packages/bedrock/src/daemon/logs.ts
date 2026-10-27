import { appendFileSync, mkdirSync, renameSync, statSync, existsSync, rmSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import { join } from "node:path";

const MIN_SECRET_LENGTH = 8;
const MAX_PENDING_LINE = 64 * 1024;

export class PebbleLogs {
  readonly path: string;
  private secrets = new Set<string>();
  // Short values such as "300" or "true" would mangle ordinary log text, so they are not redacted.
  protect(values: string[]) {
    for (const value of values) if (value.length >= MIN_SECRET_LENGTH) { this.secrets.add(value); this.secrets.add(JSON.stringify(value).slice(1, -1)); }
  }
  redact(value: string) {
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) value = value.replaceAll(secret, "[REDACTED]");
    return value;
  }
  private listeners = new Set<(chunk: Uint8Array) => void>();
  private followers = new Set<() => void>();
  private lineStart = true;
  // cloudflared stamps its own lines and is pumped in arbitrary chunks, so it opts out.
  constructor(home: string, name: string, private limit = 10 * 1024 * 1024, directory?: string, filename = "pebble.log", private timestamps = true) {
    const dir = directory ?? join(home, "pebbles", name, "logs");
    mkdirSync(dir, { recursive: true });
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
  write(chunk: Uint8Array) {
    if (this.secrets.size || this.timestamps) {
      const text = this.redact(new TextDecoder().decode(chunk));
      chunk = new TextEncoder().encode(this.timestamps ? this.stamp(text) : text);
    }
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
      appendFileSync(this.path, part);
      for (const listener of this.listeners) listener(part);
    }
  }
  async pump(stream: ReadableStream<Uint8Array>) {
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
      if (boundary) { this.write(new TextEncoder().encode(pending.slice(0, boundary))); pending = pending.slice(boundary); }
    }
    pending += decoder.decode();
    if (pending) this.write(new TextEncoder().encode(pending));
  }
  tail(lines = 100) {
    if (!existsSync(this.path)) return "";
    const fd = openSync(this.path, "r");
    try {
      const size = fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
      readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      return this.redact(buffer.toString("utf8")).split("\n").slice(-lines - 1).join("\n");
    } finally { closeSync(fd); }
  }
  async response(follow: boolean, signal: AbortSignal) {
    if (!follow) return new Response(this.tail(), { headers: { "content-type": "text/plain" } });
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
          const tail = this.tail();
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
