import type { ClientOptions } from './types';
import type { FileMetadata } from '../config/types';
import { BedrockError, asBedrockError } from '../error';
export interface UploadOptions { onProgress?: (progress: number) => void; signal?: AbortSignal }
const SINGLE_LIMIT = 90 * 1024 ** 2;
const CHUNK_SIZE = 32 * 1024 ** 2;
export function storageClient(base: URL, options: ClientOptions, isClosed: () => boolean) {
  const fileUrl = (bucket: string, id: string) => new URL(`/_bedrock/files/${encodeURIComponent(bucket)}/${encodeURIComponent(id)}`, base).href;
  async function send(path: string, method: string, body?: BodyInit, signal?: AbortSignal, extra?: HeadersInit) {
    if (isClosed()) throw new BedrockError('CLIENT_CLOSED', 'The client is closed.', 'Create a new client.');
    signal?.throwIfAborted();
    const headers = new Headers(options.headers);
    headers.set('origin', base.origin);
    new Headers(extra).forEach((value, key) => headers.set(key, value));
    try {
      const response = await fetch(new URL(path, base), { method, headers, credentials: 'include', ...(body === undefined ? {} : { body }), ...(signal ? { signal } : {}) });
      if (response.status === 204) return;
      const result = await response.json();
      if (!response.ok) throw new BedrockError(result.error?.code ?? 'UPLOAD_FAILED', result.error?.message ?? 'File request failed.', result.error?.hint ?? 'Retry the upload.');
      return result;
    } catch (error) { throw asBedrockError(error, 'UPLOAD_FAILED', 'Check your connection and retry the file request.'); }
  }
  return {
    fileUrl,
    async deleteFile(bucket: string, id: string) { await send(fileUrl(bucket, id), 'DELETE'); },
    async upload(bucket: string, file: File, uploadOptions: UploadOptions = {}): Promise<FileMetadata> {
      const { onProgress, signal } = uploadOptions;
      onProgress?.(0);
      const path = `/_bedrock/files/${encodeURIComponent(bucket)}`;
      if (file.size <= SINGLE_LIMIT) {
        const result = await send(path, 'POST', file, signal, { 'x-bedrock-file-name': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' });
        onProgress?.(1); return result;
      }
      const sha256 = await digest(file, signal);
      const { uploadId, chunkSize } = await send(`${path}/uploads`, 'POST', JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, sha256 }), signal, { 'content-type': 'application/json' });
      if (chunkSize !== CHUNK_SIZE) throw new BedrockError('UPLOAD_PROTOCOL', 'Unexpected chunk size.', 'Update the client and server together.');
      for (let offset = 0, n = 0; offset < file.size; offset += chunkSize, n++) {
        const chunk = file.slice(offset, offset + chunkSize);
        for (let attempt = 0; ; attempt++) {
          try { await send(`${path}/uploads/${uploadId}/${n}`, 'PUT', chunk, signal); break; }
          catch (error) { if (signal?.aborted || attempt >= 2 || error instanceof BedrockError && ['FORBIDDEN', 'UNAUTHENTICATED', 'INVALID_CHUNK', 'FILE_TOO_LARGE'].includes(error.code)) throw error; }
        }
        onProgress?.(Math.min(1, (offset + chunk.size) / file.size));
      }
      return await send(`${path}/uploads/${uploadId}/complete`, 'POST', undefined, signal);
    },
  };
}
async function digest(file: File, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const bytes = await file.arrayBuffer();
  signal?.throwIfAborted();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
