import { expect, test } from 'bun:test';
import { storageClient } from './storage';

test('browser transport reports sent bytes, includes credentials and metadata, and handles aborts', async () => {
  const original = globalThis.XMLHttpRequest;
  const instances: FakeXHR[] = [];
  let hold = false;
  class FakeXHR {
    withCredentials = false;
    headers = new Headers();
    upload = { onprogress: null as ((event: { loaded: number }) => void) | null };
    status = 201;
    responseText = JSON.stringify({ id: 'stored' });
    onload: (() => void) | null = null;
    onabort: (() => void) | null = null;
    onerror: (() => void) | null = null;
    aborted = false;
    constructor() { instances.push(this); }
    open(_method: string, _url: string) {}
    setRequestHeader(key: string, value: string) { this.headers.set(key, value); }
    send(body: Blob) { if (!hold) queueMicrotask(() => { this.upload.onprogress?.({ loaded: body.size / 2 }); this.upload.onprogress?.({ loaded: body.size }); this.onload?.(); }); }
    abort() { this.aborted = true; this.onabort?.(); }
  }
  globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
  try {
    const client = storageClient(new URL('http://pebble.test'), {}, () => false);
    const progress: number[] = [];
    await client.upload('assets', new File(['hello'], 'hello'), { meta: { folder: 'été' }, onProgress: p => progress.push(p) });
    expect(progress).toEqual([0, 0.5, 1, 1]);
    expect(instances[0]!.withCredentials).toBe(true);
    expect(instances[0]!.headers.has('origin')).toBe(false);
    expect(JSON.parse(decodeURIComponent(instances[0]!.headers.get('x-bedrock-file-meta')!))).toEqual({ folder: 'été' });
    hold = true;
    const controller = new AbortController();
    const pending = client.upload('assets', new File(['hello'], 'hello'), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    expect(instances[1]!.aborted).toBe(true);
  } finally { globalThis.XMLHttpRequest = original; }
});

test('fetch resume hashes slices without a whole-file read and never retries quota rejection', async () => {
  const original = globalThis.fetch;
  const originalXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = undefined as unknown as typeof XMLHttpRequest;
  let attempts = 0;
  class LocalFile extends File { override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole-file read forbidden'); } }
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('origin')).toBe('http://pebble.test');
    expect(init?.credentials).toBe('include');
    if (init?.method === 'GET') return Response.json({ uploadId: 'saved', size: 5, chunkSize: 32 * 1024 ** 2, received: [] });
    if (init?.method === 'PUT') { attempts++; return Response.json({ error: { code: 'QUOTA_EXCEEDED', message: 'Full.', hint: 'Delete files.' } }, { status: 400 }); }
    throw new Error(`Unexpected request ${input}`);
  }) as typeof fetch;
  try {
    const client = storageClient(new URL('http://pebble.test'), {}, () => false);
    await expect(client.upload('assets', new LocalFile(['hello'], 'hello'), { uploadId: 'saved' })).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(attempts).toBe(1);
    const controller = new AbortController(); controller.abort();
    await expect(client.upload('assets', new File(['x'], 'x'), { signal: controller.signal })).rejects.toThrow();
    expect(attempts).toBe(1);
  } finally { globalThis.fetch = original; globalThis.XMLHttpRequest = originalXHR; }
});
