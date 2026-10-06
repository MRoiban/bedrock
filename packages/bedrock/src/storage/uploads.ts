import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileMetadata, FunctionContext, BucketConfig } from '../config/types';
import { fileInfo, sizeBytes, storageError } from './config';
import { fsDriver, measuredStream } from './driver';
import { allowed } from './index';
export const CHUNK_SIZE = 32 * 1024 ** 2;
export const SINGLE_LIMIT = 90 * 1024 ** 2;
interface Upload { bucket: string; ownerId: string | null; name: string; mime: string; size: number; sha256: string; createdAt: number }
export function createUploads(root: string) {
  let tail: Promise<unknown> = Promise.resolve();
  const driver = fsDriver(root);
  const path = (id: string) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw storageError('UPLOAD_NOT_FOUND', 'Invalid upload id.');
    return join(root, id);
  };
  async function cleanup(now = Date.now()) {
    await mkdir(root, { recursive: true });
    for (const id of await readdir(root)) {
      if (!/^[0-9a-f-]{36}$/.test(id)) continue;
      const manifest = Bun.file(join(path(id), 'manifest.json'));
      if (await manifest.exists()) { const upload = await manifest.json() as Upload; if (now - upload.createdAt >= 86400000) await rm(path(id), { recursive: true, force: true }); }
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
    serial<T>(run: () => Promise<T>): Promise<T> { const result = tail.then(run); tail = result.catch(() => {}); return result; },
    async start(bucket: string, config: BucketConfig, ctx: FunctionContext, input: any) {
      const info = fileInfo(input?.name, input?.mime);
      if (!Number.isSafeInteger(input?.size) || input.size < 0 || input.size > sizeBytes(config.maxSize)) throw storageError('FILE_TOO_LARGE', 'Upload size exceeds the bucket limit or is invalid.');
      if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) throw storageError('INVALID_FILE', 'Chunked uploads require a lowercase SHA-256 digest.');
      const upload: Upload = { bucket, ownerId: ctx.user?.id ?? null, ...info, size: input.size, sha256: input.sha256, createdAt: Date.now() };
      const candidate: FileMetadata = { ...upload, id: '', };
      if (!await allowed(config, ctx, candidate)) throw storageError('FORBIDDEN', 'This bucket does not permit uploading.');
      if (config.accept && !config.accept.some(m => m === info.mime || m.endsWith('/*') && info.mime.startsWith(m.slice(0, -1)))) throw storageError('FILE_TYPE_REJECTED', 'The MIME type is not accepted.');
      const uploadId = crypto.randomUUID();
      await mkdir(path(uploadId), { recursive: true });
      await Bun.write(join(path(uploadId), 'manifest.json'), JSON.stringify(upload));
      return { uploadId, chunkSize: CHUNK_SIZE };
    },
    async chunk(id: string, bucket: string, ctx: FunctionContext, index: string, body: ReadableStream<Uint8Array>) {
      const upload = await load(id, bucket, ctx);
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
    async complete(id: string, bucket: string, ctx: FunctionContext) {
      const upload = await load(id, bucket, ctx);
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
      const file = await ctx.storage[bucket]!.put(stream, upload);
      if (file.size !== upload.size || file.sha256 !== upload.sha256) throw storageError('UPLOAD_CHECKSUM_MISMATCH', 'Assembled size or SHA-256 does not match the upload declaration.');
      return file;
    },
    async remove(id: string) { await rm(path(id), { recursive: true, force: true }); },
  };
}
