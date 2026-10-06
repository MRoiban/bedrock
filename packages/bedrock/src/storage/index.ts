import { and, eq, gt, asc } from 'drizzle-orm';
import type { Bucket, BucketConfig, FileMetadata, FunctionContext } from '../config/types';
import { files } from './schema';
import { fileInfo, sizeBytes, storageError } from './config';
import { fsDriver, measuredStream, type StorageDriver } from './driver';
export type { StorageDriver } from './driver';
export interface StorageBucket {
  put(body: Blob | ReadableStream<Uint8Array>, meta: { name: string; mime?: string }): Promise<FileMetadata>;
  get(id: string): Promise<Blob>;
  delete(id: string): Promise<void>;
  list(filter?: { ownerId?: string; limit?: number; cursor?: string }): Promise<FileMetadata[]>;
}
export interface Storage {
  put(bucket: Bucket, body: Blob | ReadableStream<Uint8Array>, meta: { name: string; mime?: string }): Promise<FileMetadata>;
  get(bucket: Bucket, id: string): Promise<Blob>;
  delete(bucket: Bucket, id: string): Promise<void>;
  list(bucket: Bucket, filter?: { ownerId?: string; limit?: number; cursor?: string }): Promise<FileMetadata[]>;
}
export interface StorageEffects { rollback: (() => Promise<void>)[]; commit: (() => Promise<void>)[] }
export function createStorage(root: string, buckets: readonly Bucket[], ctx: FunctionContext, writable: boolean, effects: StorageEffects): Storage {
  const driver = fsDriver(root);
  function api(bucket: Bucket) {
    if (!buckets.includes(bucket)) throw storageError('UNKNOWN_BUCKET', `Bucket ${bucket?.name ?? '(invalid)'} is not registered.`, 'Add this exact bucket object to definePebble({ storage: [bucket] }).');
    return bucketApi(bucket.name, bucket, ctx, writable, effects, driver);
  }
  return {
    put: (bucket, body, meta) => api(bucket).put(body, meta),
    get: (bucket, id) => api(bucket).get(id),
    delete: (bucket, id) => api(bucket).delete(id),
    list: (bucket, filter) => api(bucket).list(filter),
  };
}
export async function allowed(config: BucketConfig, ctx: FunctionContext, file: FileMetadata, deleting = false) {
  if (deleting && ctx.user && file.ownerId === ctx.user.id) return true;
  if (typeof config.access === 'function') return !!await config.access(ctx, file);
  if (deleting) return false;
  return config.access === 'public' || config.access === 'users' && !!ctx.user || config.access === 'owner' && !!ctx.user && file.ownerId === ctx.user.id;
}
export function bucketApi(bucket: string, config: BucketConfig, ctx: FunctionContext, writable: boolean, effects: StorageEffects, driver: StorageDriver): StorageBucket {
  const write = () => { if (!writable) throw storageError('READ_ONLY', 'Storage writes must run inside a mutation.'); };
  async function metadata(id: string) {
    const file = ctx.db.select().from(files).where(and(eq(files.bucket, bucket), eq(files.id, id))).get();
    if (!file) throw storageError('FILE_NOT_FOUND', 'File does not exist.');
    return file;
  }
  return {
    async put(body, meta) {
      write();
      const info = fileInfo(meta.name, meta.mime ?? (body instanceof Blob ? body.type || undefined : undefined));
      const file: FileMetadata = { ...info, id: crypto.randomUUID(), bucket, ownerId: ctx.user?.id ?? null, size: 0, sha256: '', createdAt: Date.now() };
      if (!await allowed(config, ctx, file)) throw storageError(!ctx.user && config.access !== 'public' ? 'UNAUTHENTICATED' : 'FORBIDDEN', 'This bucket does not permit uploading.');
      if (config.accept && !config.accept.some(m => m === file.mime || m.endsWith('/*') && file.mime.startsWith(m.slice(0, -1)))) throw storageError('FILE_TYPE_REJECTED', 'The MIME type is not accepted by this bucket.');
      const key = `${bucket}/${file.id}`;
      effects.rollback.push(() => driver.delete(key));
      await driver.put(key, measuredStream(body, sizeBytes(config.maxSize), file));
      ctx.db.insert(files).values(file).run();
      return file;
    },
    async get(id) { const file = await metadata(id); if (!await allowed(config, ctx, file)) throw storageError(!ctx.user && config.access !== 'public' ? 'UNAUTHENTICATED' : 'FORBIDDEN', 'You cannot read this file.'); return driver.get(`${bucket}/${id}`); },
    async delete(id) { write(); const file = await metadata(id); if (!await allowed(config, ctx, file, true)) throw storageError('FORBIDDEN', 'You cannot delete this file.'); ctx.db.delete(files).where(eq(files.id, id)).run(); effects.commit.push(() => driver.delete(`${bucket}/${id}`)); },
    async list(filter = {}) {
      const limit = filter.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw storageError('INVALID_FILE', 'List limit must be between 1 and 1000.');
      const conditions = [eq(files.bucket, bucket)];
      if (filter.ownerId !== undefined) conditions.push(eq(files.ownerId, filter.ownerId));
      if (config.access === 'owner') { if (!ctx.user) throw storageError('UNAUTHENTICATED', 'Sign in to list owner files.'); conditions.push(eq(files.ownerId, ctx.user.id)); }
      if (filter.cursor) conditions.push(gt(files.id, filter.cursor));
      const rows = ctx.db.select().from(files).where(and(...conditions)).orderBy(asc(files.id)).all();
      const result: FileMetadata[] = [];
      for (const file of rows) { if (await allowed(config, ctx, file)) result.push(file); if (result.length === limit) break; }
      return result;
    },
  };
}
