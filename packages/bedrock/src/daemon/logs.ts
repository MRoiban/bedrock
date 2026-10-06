import { appendFileSync, mkdirSync, renameSync, statSync, existsSync, rmSync, openSync, readSync, closeSync, fstatSync } from "node:fs";
import { join } from "node:path";

export class PebbleLogs {
  readonly path: string;
  private listeners = new Set<(chunk: Uint8Array) => void>();
  private followers = new Set<() => void>();
  constructor(home: string, name: string, private limit = 10 * 1024 * 1024, directory?: string, filename = "pebble.log") {
    const dir = directory ?? join(home, "pebbles", name, "logs");
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, filename);
  }
  write(chunk: Uint8Array) {
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
    for await (const chunk of stream) this.write(chunk);
  }
  tail(lines = 100) {
    if (!existsSync(this.path)) return "";
    const fd = openSync(this.path, "r");
    try {
      const size = fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
      readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      return buffer.toString("utf8").split("\n").slice(-lines - 1).join("\n");
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
