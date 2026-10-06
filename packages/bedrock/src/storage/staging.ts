import { join } from 'node:path';
import { rm, readdir, stat } from 'node:fs/promises';
import { fsDriver, measuredStream } from './driver';
import type { StagedFile } from './index';
const active = new Set<string>();
export async function withUploadBody<T>(body: ReadableStream<Uint8Array>, signal: AbortSignal | undefined, run: (stream: ReadableStream<Uint8Array>) => Promise<T>): Promise<T> {
  const reader = body.getReader();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) { try { signal?.throwIfAborted(); const next = await reader.read(); signal?.throwIfAborted(); if (next.done) controller.close(); else controller.enqueue(next.value); } catch (error) { controller.error(error); } },
    async cancel() { await reader.cancel(); },
  });
  try { return await run(stream); }
  finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function stage(root: string, body: ReadableStream<Uint8Array>, max: number, signal?: AbortSignal): Promise<StagedFile> {
  const id = crypto.randomUUID();
  const path = join(root, 'staging', id);
  const result = { size: 0, sha256: '' };
  active.add(path);
  try {
    await withUploadBody(body, signal, stream => fsDriver(root).put(`staging/${id}`, measuredStream(stream, max, result)));
    return { path, ...result };
  } catch (error) { await rm(path, { force: true }); throw error; }
  finally { active.delete(path); }
}
export async function cleanupStaging(root: string, now = Date.now()) {
  const dir = join(root, 'staging');
  const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  for (const entry of entries) {
    const path = join(dir, entry);
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (info && !active.has(path) && now - info.mtimeMs > 86400000) await rm(path, { force: true });
  }
}
