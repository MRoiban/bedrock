import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { FunctionContext, BucketConfig } from '../config/types';
import { fileInfo, sizeBytes, storageError, uploadMeta } from './config';
import { fsDriver, measuredStream } from './driver';
import { authorizeUpload } from './index';
import { stage, cleanupStaging } from './staging';
export const CHUNK_SIZE = 32 * 1024 ** 2;
export const SINGLE_LIMIT = 90 * 1024 ** 2;
interface Upload { bucket: string; ownerId: string | null; name: string; mime: string; size: number; sha256?: string; meta?: unknown; createdAt: number }
export function createUploads(root: string) {
  const tails = new Map<string, Promise<unknown>>();
  const driver = fsDriver(root);
  const path = (id: string) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw storageError('UPLOAD_NOT_FOUND', 'Invalid upload id.');
    return join(root, id);
  };
  function serial<T>(id: string, run: () => Promise<T>): Promise<T> {
    const result = (tails.get(id) ?? Promise.resolve()).then(run);
    const tail = result.catch(() => {});
    tails.set(id, tail);
    void tail.then(() => { if (tails.get(id) === tail) tails.delete(id); });
    return result;
  }
  async function cleanup(now = Date.now()) {
    await cleanupStaging(root, now);
    await mkdir(root, { recursive: true });
    for (const id of await readdir(root)) {
      if (!/^[0-9a-f-]{36}$/.test(id) || tails.has(id)) continue;
      await serial(id, async () => {
        const manifest = Bun.file(join(path(id), 'manifest.json'));
        if (await manifest.exists()) { const upload = await manifest.json() as Upload; if (now - upload.createdAt >= 86400000) await rm(path(id), { recursive: true, force: true }); }
      });
    }
  }
  async function load(id: string, bucket: string, ctx: FunctionContext) {
    const manifest = Bun.file(join(path(id), 'manifest.json'));
    if (!await manifest.exists()) throw storageError('UPLOAD_NOT_FOUND', 'Upload has expired or does not exist.');
    const upload = await manifest.json() as Upload;
    if (upload.bucket !== bucket || upload.ownerId !== (ctx.user?.id ?? null)) throw storageError('FORBIDDEN', 'This upload belongs to another user or bucket.');
    return upload;
  }
  return {
    cleanup,
    serial,
    load,
    async start(bucket: string, config: BucketConfig, ctx: FunctionContext, input: any) {
      const info = fileInfo(input?.name, input?.mime);
      if (!Number.isSafeInteger(input?.size) || input.size < 0 || input.size > sizeBytes(config.maxSize)) throw storageError('FILE_TOO_LARGE', 'Upload size exceeds the bucket limit or is invalid.');
      if (input.sha256 !== undefined && (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256))) throw storageError('INVALID_FILE', 'When supplied, sha256 must be a lowercase SHA-256 digest.');
      const upload: Upload = { bucket, ownerId: ctx.user?.id ?? null, ...info, size: input.size, sha256: input.sha256, meta: uploadMeta(input.meta), createdAt: Date.now() };
      await authorizeUpload(config, ctx, { ...upload, meta: upload.meta });
      const uploadId = crypto.randomUUID();
      await mkdir(path(uploadId), { recursive: true });
      await Bun.write(join(path(uploadId), 'manifest.json'), JSON.stringify(upload));
      return { uploadId, chunkSize: CHUNK_SIZE };
    },
    async chunk(id: string, upload: Upload, index: string, body: ReadableStream<Uint8Array>) {
      if (!/^(0|[1-9]\d*)$/.test(index)) throw storageError('INVALID_CHUNK', 'Chunk index must be a nonnegative integer.');
      const n = Number(index), count = Math.ceil(upload.size / CHUNK_SIZE);
      if (!Number.isSafeInteger(n) || n >= count) throw storageError('INVALID_CHUNK', 'Chunk index is outside the declared file.');
      const expected = Math.min(CHUNK_SIZE, upload.size - n * CHUNK_SIZE);
      const result = { size: 0, sha256: '' };
      // Validate before rename so a failed retry preserves the last successful chunk.
      const checked = measuredStream(body, expected, result);
      const reader = checked.getReader();
      const exact = new ReadableStream<Uint8Array>({
        async pull(controller) { try { const next = await reader.read(); if (next.done) { if (result.size !== expected) throw storageError('INVALID_CHUNK', 'Chunk length does not match the declared size.'); controller.close(); } else controller.enqueue(next.value); } catch (error) { controller.error(error); } },
        async cancel() { await reader.cancel(); },
      });
      await driver.put(`${id}/${n}`, exact);
    },
    async complete(id: string, upload: Upload, sha256?: string, signal?: AbortSignal) {
      if (sha256 !== undefined && !/^[a-f0-9]{64}$/.test(sha256)) throw storageError('INVALID_FILE', 'Provide a lowercase SHA-256 digest.');
      const count = Math.ceil(upload.size / CHUNK_SIZE);
      for (let n = 0; n < count; n++) {
        const info = await driver.stat(`${id}/${n}`);
        if (!info || info.size !== Math.min(CHUNK_SIZE, upload.size - n * CHUNK_SIZE)) throw storageError('INVALID_CHUNK', `Chunk ${n} is missing or incomplete; retry it.`);
      }
      async function* assemble() {
        for (let n = 0; n < count; n++) { const reader = driver.get(`${id}/${n}`).stream().getReader(); try { while (true) { const next = await reader.read(); if (next.done) break; yield next.value; } } finally { reader.releaseLock(); } }
      }
      const iterator = assemble();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) { try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); } catch (error) { controller.error(error); } },
        async cancel() { await iterator.return(undefined); },
      });
      const file = await stage(root, stream, upload.size, signal);
      if (file.size !== upload.size || upload.sha256 && file.sha256 !== upload.sha256 || sha256 && file.sha256 !== sha256) {
        await rm(file.path, { force: true });
        throw storageError('UPLOAD_CHECKSUM_MISMATCH', 'Assembled size or SHA-256 does not match the upload declaration.');
      }
      return file;
    },
    async status(id: string, upload: Upload) {
      const received: number[] = [];
      for (let n = 0; n < Math.ceil(upload.size / CHUNK_SIZE); n++) {
        const info = await driver.stat(`${id}/${n}`);
        if (info?.size === Math.min(CHUNK_SIZE, upload.size - n * CHUNK_SIZE)) received.push(n);
      }
      return { uploadId: id, size: upload.size, chunkSize: CHUNK_SIZE, received };
    },
    async remove(id: string) { await rm(path(id), { recursive: true, force: true }); },
  };
}
