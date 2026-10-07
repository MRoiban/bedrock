import { expect, test } from 'bun:test';
import { storageClient } from './storage';

test('browser transport reports sent bytes, includes credentials and metadata, and handles aborts', async () => {
  const original = globalThis.XMLHttpRequest, originalFetch = globalThis.fetch;
  const instances: FakeXHR[] = [];
  let hold = false;
  class FakeXHR {
    withCredentials = false;
    headers = new Headers();
    upload = { onprogress: null as ((event: { loaded: number }) => void) | null };
    status = 201;
    responseText = JSON.stringify({ id: 'stored' });
    getResponseHeader(name: string) { return name === "x-bedrock-release" ? "xhr-release" : null; }
    onload: (() => void) | null = null;
    onabort: (() => void) | null = null;
    onerror: (() => void) | null = null;
    aborted = false;
    constructor() { instances.push(this); }
    open(method: string, _url: string) { if (method === 'PUT') this.status = 204; }
    setRequestHeader(key: string, value: string) { this.headers.set(key, value); }
    send(body: Blob) { if (!hold) queueMicrotask(() => { this.upload.onprogress?.({ loaded: body.size / 2 }); this.upload.onprogress?.({ loaded: body.size }); this.onload?.(); }); }
    abort() { this.aborted = true; this.onabort?.(); }
  }
  globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
  try {
    const releases: (string | null)[] = [];
    const client = storageClient(new URL('http://pebble.test'), {}, () => false, response => releases.push(response.headers.get('x-bedrock-release')));
    const progress: number[] = [];
    await client.upload('assets', new File(['hello'], 'hello'), { meta: { folder: 'été' }, onProgress: p => progress.push(p) });
    expect(progress).toEqual([0, 0.5, 1, 1]);
    expect(releases).toEqual(["xhr-release"]);
    expect(instances[0]!.withCredentials).toBe(true);
    expect(instances[0]!.headers.has('origin')).toBe(false);
    expect(JSON.parse(decodeURIComponent(instances[0]!.headers.get('x-bedrock-file-meta')!))).toEqual({ folder: 'été' });
    const tokenClient = storageClient(new URL('http://pebble.test'), { token: 'brk_test', headers: { cookie: 'unwanted' } }, () => false);
    await tokenClient.upload('assets', new File(['hello'], 'hello'), { meta: { folder: 'token' } });
    expect(instances[1]!.withCredentials).toBe(false);
    expect(instances[1]!.headers.get('authorization')).toBe('Bearer brk_test');
    expect(instances[1]!.headers.has('cookie')).toBe(false);
    expect(instances[1]!.headers.has('origin')).toBe(false);
    expect(JSON.parse(decodeURIComponent(instances[1]!.headers.get('x-bedrock-file-meta')!))).toEqual({ folder: 'token' });
    for (const token of [undefined, 'brk_test']) {
      const methods: string[] = [];
      globalThis.fetch = (async (_input: URL, init: RequestInit) => {
        const headers = new Headers(init.headers);
        expect(init.credentials).toBe(token ? 'omit' : 'include');
        expect(headers.get('authorization')).toBe(token ? `Bearer ${token}` : null);
        expect(headers.get('origin')).toBe('http://pebble.test');
        methods.push(init.method!);
        if (init.method === 'GET') return Response.json({ uploadId: 'saved', size: 5, chunkSize: 32 * 1024 ** 2, received: [] });
        expect(JSON.parse(init.body as string)).toEqual({ sha256: new Bun.CryptoHasher('sha256').update('hello').digest('hex') });
        return Response.json({ id: 'stored' }, { status: 201 });
      }) as typeof fetch;
      const resumed = storageClient(new URL('http://pebble.test'), token ? { token } : {}, () => false);
      await resumed.upload('assets', new File(['hello'], 'hello'), { uploadId: 'saved' });
      expect(methods).toEqual(['GET', 'POST']);
      expect(instances.at(-1)!.withCredentials).toBe(!token);
      expect(instances.at(-1)!.headers.get('authorization')).toBe(token ? `Bearer ${token}` : null);
      expect(instances.at(-1)!.headers.has('origin')).toBe(false);
    }
    hold = true;
    const controller = new AbortController();
    const pending = client.upload('assets', new File(['hello'], 'hello'), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    expect(instances.at(-1)!.aborted).toBe(true);
  } finally { globalThis.XMLHttpRequest = original; globalThis.fetch = originalFetch; }
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

for (const token of [undefined, 'brk_test']) test(`fetch upload and resume preserve metadata, late digest and ${token ? 'token' : 'session'} authentication`, async () => {
  const original = globalThis.fetch, originalXHR = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = undefined as unknown as typeof XMLHttpRequest;
  const calls: string[] = [];
  let expired = false;
  const meta = { folder: 'été' };
  globalThis.fetch = (async (input: URL, init: RequestInit) => {
    const headers = new Headers(init.headers);
    expect(init.credentials).toBe(token ? 'omit' : 'include');
    expect(headers.get('authorization')).toBe(token ? `Bearer ${token}` : null);
    expect(headers.has('cookie')).toBe(!token);
    expect(headers.get('origin')).toBe('http://pebble.test');
    const path = input.pathname; calls.push(`${init.method} ${path}`);
    if (path.endsWith('/complete')) {
      expect(JSON.parse(init.body as string)).toEqual({ sha256: new Bun.CryptoHasher('sha256').update('hello').digest('hex') });
      return Response.json({ id: 'stored' }, { status: 201 });
    }
    if (init.method === 'GET' && expired) return Response.json({ error: { code: 'UPLOAD_NOT_FOUND' } }, { status: 404 });
    if (init.method === 'GET') return Response.json({ uploadId: 'saved', size: 5, chunkSize: 32 * 1024 ** 2, received: [0] });
    if (path.endsWith('/uploads')) {
      expect(JSON.parse(init.body as string)).toEqual({ name: 'hello', mime: 'application/octet-stream', size: 5, meta });
      return Response.json({ uploadId: 'new', chunkSize: 32 * 1024 ** 2 }, { status: 201 });
    }
    if (init.method === 'PUT') return new Response(null, { status: 204 });
    expect(JSON.parse(decodeURIComponent(headers.get('x-bedrock-file-meta')!))).toEqual(meta);
    return Response.json({ id: 'stored' }, { status: 201 });
  }) as typeof fetch;
  try {
    const client = storageClient(new URL('http://pebble.test'), { ...(token ? { token } : {}), headers: { cookie: 'session' } }, () => false);
    const file = new File(['hello'], 'hello');
    await client.upload('assets', file, { meta });
    await client.upload('assets', file, { uploadId: 'saved', meta });
    expect(calls).toEqual(['POST /_bedrock/files/assets', 'GET /_bedrock/files/assets/uploads/saved', 'POST /_bedrock/files/assets/uploads/saved/complete']);
    expired = true;
    await client.upload('assets', file, { uploadId: 'expired', meta });
    expect(calls.slice(-3)).toEqual(['POST /_bedrock/files/assets/uploads', 'PUT /_bedrock/files/assets/uploads/new/0', 'POST /_bedrock/files/assets/uploads/new/complete']);
  } finally { globalThis.fetch = original; globalThis.XMLHttpRequest = originalXHR; }
});
