import { and, eq } from 'drizzle-orm';
import type { PebbleConfig, FileMetadata } from '../config/types';
import type { createExecutor } from '../runtime/functions';
import { errorResponse } from '../runtime/http';
import { storageError } from './config';
import { files } from './schema';
import { createUploads, SINGLE_LIMIT } from './uploads';
import { measuredStream } from './driver';
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
        const result = await execute.storage('mutation', request, ctx => ctx.storage.put(config, measuredStream(request.body!, SINGLE_LIMIT, { size: 0, sha256: '' }), {
          name: request.headers.get('x-bedrock-file-name') ? decodeURIComponent(request.headers.get('x-bedrock-file-name')!) : 'file', mime: request.headers.get('content-type') ?? 'application/octet-stream',
        }));
        return Response.json(result.value, { status: 201 });
      }
      if (id === 'uploads') return await uploads.serial(async () => {
        await uploads.cleanup();
        if (!uploadId && method === 'POST') {
          const input = await request.json();
          const result = await execute.storage('query', request, ctx => uploads.start(bucket, config, ctx, input));
          return Response.json(result.value, { status: 201 });
        }
        if (uploadId && action === 'complete' && method === 'POST' && parts.length === 4) {
          const result = await execute.storage('mutation', request, ctx => uploads.complete(uploadId, config, ctx));
          await uploads.remove(uploadId);
          return Response.json(result.value, { status: 201 });
        }
        if (uploadId && action !== undefined && method === 'PUT' && parts.length === 4 && request.body) {
          await execute.storage('query', request, ctx => uploads.chunk(uploadId, bucket, ctx, action, request.body!));
          return new Response(null, { status: 204 });
        }
        throw storageError('UPLOAD_NOT_FOUND', 'Unknown chunk upload endpoint.');
      });
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
  return { handle, cleanup: () => uploads.serial(() => uploads.cleanup()) };
}
