import { asBedrockError } from "../error";
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { storageError } from './config';
export interface StorageDriver {
  put(key: string, body: Blob | ReadableStream<Uint8Array>): Promise<void>;
  get(key: string, range?: { start: number; end: number }): Blob;
  delete(key: string): Promise<void>;
  stat(key: string): Promise<{ size: number } | null>;
}
export function fsDriver(root: string): StorageDriver {
  function path(key: string) {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(key)) throw storageError('INVALID_FILE', 'Invalid storage key.');
    return join(root, key);
  }
  return {
    async put(key, body) {
      const target = path(key), temp = `${target}.${crypto.randomUUID()}.tmp`;
      await mkdir(dirname(target), { recursive: true });
      const writer = Bun.file(temp).writer();
      const reader = (body instanceof Blob ? body.stream() : body).getReader();
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; writer.write(value); await writer.flush(); }
        await writer.end(); await rename(temp, target);
      } catch (error) { await reader.cancel().catch(() => {}); await Promise.resolve(writer.end()).catch(() => {}); await rm(temp, { force: true }); throw asBedrockError(error, "STORAGE_WRITE_FAILED", "Check that the storage directory is writable, then retry."); }
      finally { reader.releaseLock(); }
    },
    get(key, range) { const file = Bun.file(path(key)); return range ? file.slice(range.start, range.end + 1) : file; },
    async delete(key) { await rm(path(key), { force: true }); },
    async stat(key) { try { return { size: (await stat(path(key))).size }; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } },
  };
}
export function measuredStream(body: Blob | ReadableStream<Uint8Array>, max: number, result: { size: number; sha256: string }) {
  const reader = (body instanceof Blob ? body.stream() : body).getReader();
  const hash = new Bun.CryptoHasher('sha256');
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { result.sha256 = hash.digest('hex'); reader.releaseLock(); controller.close(); return; }
        result.size += value.byteLength;
        if (result.size > max) throw storageError('FILE_TOO_LARGE', `File exceeds the ${max} byte limit.`);
        hash.update(value); controller.enqueue(value);
      } catch (error) { await reader.cancel().catch(() => {}); controller.error(error); }
    },
    async cancel() { await reader.cancel(); },
  });
}
