import { and, eq } from 'drizzle-orm';
import type { PebbleConfig, FileMetadata } from '../config/types';
import type { createExecutor } from '../runtime/functions';
import { errorResponse } from '../runtime/http';
import { storageError, fileInfo, sizeBytes, headerMeta } from './config';
import { files } from './schema';
import { createUploads, SINGLE_LIMIT } from './uploads';
import { rm } from 'node:fs/promises';
import { stage, withUploadBody } from './staging';
import { authorizeUpload, adoptStored } from './index';
const inlineSafe = (mime: string) => /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|mp4|ogg|wav|webm)|application\/pdf|text\/plain)$/.test(mime);
export function downloadHeaders(file: FileMetadata, isPublic: boolean) {
  return new Headers({
    'Content-Type': file.mime, 'Content-Length': String(file.size), ETag: `"${file.sha256}"`,
    'Cache-Control': isPublic ? 'public, max-age=3600' : 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Accept-Ranges': 'bytes',
    'Content-Disposition': `${inlineSafe(file.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", '%27')}`,
  });
}
export function createFileHandler(pebble: PebbleConfig, execute: ReturnType<typeof createExecutor>, root: string) {
  const uploads = createUploads(root);
  async function handle(request: Request) {
    try {
      const parts = new URL(request.url).pathname.slice('/_bedrock/files/'.length).split('/');
      const [bucket = '', id, uploadId, action] = parts;
      const config = pebble.storage?.find(value => value.name === bucket);
      if (!config) throw storageError('BUCKET_NOT_FOUND', 'Unknown storage bucket.');
      const method = request.method;
      if (!id && method === 'POST') {
        if (!request.body) throw storageError('INVALID_FILE', 'Upload body is required.');
        const info = { ...fileInfo(request.headers.get('x-bedrock-file-name') ? decodeURIComponent(request.headers.get('x-bedrock-file-name')!) : 'file', request.headers.get('content-type') ?? undefined), meta: headerMeta(request.headers.get('x-bedrock-file-meta')) };
        const declared = request.headers.has('content-length') ? Number(request.headers.get('content-length')) : null;
        if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > SINGLE_LIMIT)) throw storageError('FILE_TOO_LARGE', 'Invalid single upload size.');
        await execute.storage('query', request, ctx => authorizeUpload(config, ctx, { ...info, bucket, size: declared, ownerId: ctx.user?.id ?? null }));
        const staged = await stage(root, request.body, Math.min(SINGLE_LIMIT, sizeBytes(config.maxSize)), request.signal);
        try {
          const result = await execute.storage('mutation', request, ctx => { request.signal.throwIfAborted(); return adoptStored(ctx.storage, config, staged, info); });
          return Response.json(result.value, { status: 201 });
        } finally { await rm(staged.path, { force: true }); }
      }
      if (id === 'uploads') {
        await uploads.cleanup();
        if (!uploadId && method === 'POST') {
          const input = await request.json();
          const result = await execute.storage('query', request, ctx => uploads.start(bucket, config, ctx, input));
          return Response.json(result.value, { status: 201 });
        }
        if (uploadId) return await uploads.serial(uploadId, async () => {
          const result = await execute.storage('query', request, async ctx => {
            const upload = await uploads.load(uploadId, bucket, ctx);
            const { admit: _admit, ...policy } = config;
            await authorizeUpload(policy, ctx, { ...upload, meta: upload.meta });
            return upload;
          });
          const upload = result.value as Awaited<ReturnType<typeof uploads.load>>;
          if (method === 'GET' && parts.length === 3) return Response.json(await uploads.status(uploadId, upload));
          if (action === 'complete' && method === 'POST' && parts.length === 4) {
            const input = request.body ? await request.json() : {};
            const staged = await uploads.complete(uploadId, upload, input?.sha256, request.signal);
            try {
              const committed = await execute.storage('mutation', request, ctx => { request.signal.throwIfAborted(); return adoptStored(ctx.storage, config, staged, upload); });
              await uploads.remove(uploadId);
              return Response.json(committed.value, { status: 201 });
            } catch (error) { await uploads.remove(uploadId); throw error; }
            finally { await rm(staged.path, { force: true }); }
          }
          if (action !== undefined && method === 'PUT' && parts.length === 4 && request.body) {
            await withUploadBody(request.body, request.signal, stream => uploads.chunk(uploadId, upload, action, stream));
            return new Response(null, { status: 204 });
          }
          throw storageError('UPLOAD_NOT_FOUND', 'Unknown chunk upload endpoint.');
        });
        throw storageError('UPLOAD_NOT_FOUND', 'Unknown chunk upload endpoint.');
      }
      if (id && parts.length === 2 && method === 'DELETE') {
        await execute.storage('mutation', request, ctx => ctx.storage.delete(config, id));
        return new Response(null, { status: 204 });
      }
      if (id && parts.length === 2 && (method === 'GET' || method === 'HEAD')) {
        const result = await execute.storage('query', request, async ctx => {
          const blob = await ctx.storage.get(config, id);
          const file = ctx.db.select().from(files).where(and(eq(files.id, id), eq(files.bucket, bucket))).get()!;
          return { blob, file };
        });
        const { blob, file } = result.value as { blob: Blob; file: FileMetadata };
        const headers = downloadHeaders(file, config.access === 'public');
        if (request.headers.get('if-none-match') === headers.get('etag')) return new Response(null, { status: 304, headers });
        const range = request.headers.get('range');
        if (range && (!request.headers.has('if-range') || request.headers.get('if-range') === headers.get('etag'))) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          let start = 0, end = file.size - 1;
          if (match) { if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); } else if (match[2]) start = Math.max(0, file.size - Number(match[2])); }
          if (!match || !match[1] && !match[2] || start > end || start >= file.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
            headers.set('Content-Range', `bytes */${file.size}`); headers.delete('Content-Length'); return new Response(null, { status: 416, headers });
          }
          headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`); headers.set('Content-Length', String(end - start + 1));
          return new Response(method === 'HEAD' ? null : blob.slice(start, end + 1), { status: 206, headers });
        }
        return new Response(method === 'HEAD' ? null : blob, { headers });
      }
      throw storageError('FILE_NOT_FOUND', 'Unknown file endpoint.');
    } catch (error) { return errorResponse(error); }
  }
  return { handle, cleanup: () => uploads.cleanup() };
}
