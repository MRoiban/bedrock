import { Sha256 } from './sha256';
import type { ClientOptions } from './types';
import type { FileMetadata } from '../config/types';
import { BedrockError, asBedrockError } from '../error';
export interface UploadOptions { onProgress?: (progress: number) => void; signal?: AbortSignal; meta?: unknown; uploadId?: string; onUploadId?: (id: string) => void }
const SINGLE_LIMIT = 90 * 1024 ** 2;
const CHUNK_SIZE = 32 * 1024 ** 2;
export function storageClient(base: URL, options: ClientOptions, isClosed: () => boolean) {
  const fileUrl = (bucket: string, id: string) => new URL(`/_bedrock/files/${encodeURIComponent(bucket)}/${encodeURIComponent(id)}`, base).href;
  async function send(path: string, method: string, body?: BodyInit, signal?: AbortSignal, extra?: HeadersInit, progress?: (bytes: number) => void) {
    if (isClosed()) throw new BedrockError('CLIENT_CLOSED', 'The client is closed.', 'Create a new client.');
    signal?.throwIfAborted();
    const headers = new Headers(options.headers);
    headers.set('origin', base.origin);
    new Headers(extra).forEach((value, key) => headers.set(key, value));
    try {
      const response = typeof XMLHttpRequest !== 'undefined' && body instanceof Blob ? await xhr(new URL(path, base), method, headers, body, signal, progress) : await fetch(new URL(path, base), { method, headers, credentials: 'include', ...(body === undefined ? {} : { body }), ...(signal ? { signal } : {}) });
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
      const { onProgress, signal, meta, onUploadId } = uploadOptions;
      let encodedMeta: string | undefined;
      try {
        if (meta !== undefined) {
          const json = JSON.stringify(meta);
          if (json === undefined) throw new BedrockError('INVALID_FILE', 'Upload metadata must be JSON serializable.', 'Send JSON-serializable upload metadata.');
          encodedMeta = encodeURIComponent(json);
          if (encodedMeta.length > 4096) throw new BedrockError('INVALID_FILE', 'Upload metadata exceeds 4 KiB encoded.', 'Send smaller metadata.');
        }
      } catch (error) { throw asBedrockError(error, 'INVALID_FILE', 'Send JSON-serializable upload metadata.'); }
      onProgress?.(0);
      const path = `/_bedrock/files/${encodeURIComponent(bucket)}`;
      if (file.size <= SINGLE_LIMIT && !uploadOptions.uploadId) {
        const result = await send(path, 'POST', file, signal, { 'x-bedrock-file-name': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream', ...(encodedMeta === undefined ? {} : { 'x-bedrock-file-meta': encodedMeta }) }, bytes => onProgress?.(file.size ? bytes / file.size : 1));
        onProgress?.(1); return result;
      }
      let uploadId = uploadOptions.uploadId;
      let chunkSize = CHUNK_SIZE;
      let received: number[] = [];
      if (uploadId) {
        try {
          const status = await send(`${path}/uploads/${uploadId}`, 'GET', undefined, signal);
          if (status.size !== file.size) throw new BedrockError('UPLOAD_PROTOCOL', 'Resume file size differs from the upload.', 'Select the original file.');
          chunkSize = status.chunkSize; received = status.received;
        } catch (error) { if (!(error instanceof BedrockError) || error.code !== 'UPLOAD_NOT_FOUND') throw error; uploadId = undefined; }
      }
      if (!uploadId) {
        const started = await send(`${path}/uploads`, 'POST', JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size, meta }), signal, { 'content-type': 'application/json' });
        uploadId = started.uploadId; chunkSize = started.chunkSize;
      }
      onUploadId?.(uploadId!);
      const hash = new Sha256();
      let progress = 0;
      const report = (bytes: number) => { progress = Math.max(progress, Math.min(1, bytes / file.size)); onProgress?.(progress); };
      if (chunkSize !== CHUNK_SIZE) throw new BedrockError('UPLOAD_PROTOCOL', 'Unexpected chunk size.', 'Update the client and server together.');
      for (let offset = 0, n = 0; offset < file.size; offset += chunkSize, n++) {
        const chunk = file.slice(offset, offset + chunkSize);
        signal?.throwIfAborted();
        hash.update(new Uint8Array(await chunk.arrayBuffer()));
        signal?.throwIfAborted();
        if (!received.includes(n)) for (let attempt = 0; ; attempt++) {
          try { await send(`${path}/uploads/${uploadId}/${n}`, 'PUT', chunk, signal, undefined, bytes => report(offset + bytes)); break; }
          catch (error) { if (signal?.aborted || attempt >= 2 || error instanceof BedrockError && ['FORBIDDEN', 'UNAUTHENTICATED', 'INVALID_CHUNK', 'FILE_TOO_LARGE', 'QUOTA_EXCEEDED'].includes(error.code)) throw error; }
        }
        report(offset + chunk.size);
      }
      return await send(`${path}/uploads/${uploadId}/complete`, 'POST', JSON.stringify({ sha256: hash.digest() }), signal, { 'content-type': 'application/json' });
    },
  };
}
function xhr(url: URL, method: string, headers: Headers, body: Blob, signal?: AbortSignal, progress?: (bytes: number) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    request.open(method, url.href);
    request.withCredentials = true;
    // Browsers supply Origin themselves and forbid setting it explicitly.
    headers.forEach((value, key) => { if (key !== 'origin') request.setRequestHeader(key, value); });
    request.upload.onprogress = event => progress?.(event.loaded);
    request.onload = () => { cleanup(); resolve(new Response(request.status === 204 ? null : request.responseText, { status: request.status })); };
    request.onerror = () => { cleanup(); reject(new BedrockError('UPLOAD_FAILED', 'File request failed.', 'Check your connection and retry.')); };
    request.onabort = () => { cleanup(); reject(signal?.reason ?? new BedrockError('UPLOAD_ABORTED', 'Upload aborted.', 'Retry the upload.')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { cleanup(); reject(signal.reason); return; }
    request.send(body);
  });
}
