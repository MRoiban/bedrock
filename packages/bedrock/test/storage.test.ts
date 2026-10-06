import { test, expect } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { definePebble, bucket, mutation, query } from '../src/config';
import { startPebble } from '../src/runtime';
import { createClient } from '../src/client';
import { CHUNK_SIZE } from '../src/storage/uploads';
import { tempDirectory } from './helpers';
import { storageIdentity } from './storage-identity';
const storage = {
  attachments: bucket('attachments', { maxSize: '128mb', access: 'owner' }),
  tiny: bucket('tiny', { maxSize: 8, access: 'public', accept: ['text/*'] }),
  public: bucket('public', { maxSize: '1mb', access: 'public' }),
  users: bucket('users', { maxSize: '1mb', access: 'users' }),
  custom: bucket('custom', { maxSize: '1mb', access: (ctx, file) => ctx.user?.id === 'editor' || !!ctx.user && file.ownerId === ctx.user.id }),
};
const pebble = definePebble({ name: 'storage-test', sync: true, storage: Object.values(storage),
  queries: { list: query(ctx => ctx.storage.list(storage.attachments)) },
  mutations: {
    put: mutation(ctx => ctx.storage.put(storage.attachments, new Blob(['hello']), { name: 'hello.txt', mime: 'text/plain' })),
    fail: mutation(async ctx => { await ctx.storage.put(storage.attachments, new Blob(['discard']), { name: 'fail' }); throw new Error('rollback'); }),
    deleteFail: mutation(async ctx => { const [file] = await ctx.storage.list(storage.attachments); await ctx.storage.delete(storage.attachments, file!.id); throw new Error('rollback'); }),
    tooBig: mutation(ctx => ctx.storage.put(storage.tiny, new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('123456')); controller.enqueue(new TextEncoder().encode('789')); controller.close(); } }), { name: 'big', mime: 'text/plain' })),
  },
});
async function fixture() {
  const temp = tempDirectory(), identity = storageIdentity();
  let running = await startPebble({ pebble, dir: temp.dir, dataDir: temp.dir, port: 0 });
  const request = (user = 'alice') => new Request(running.server.url, { headers: identity.headers(user) });
  const call = (path: string, init: RequestInit = {}, user = 'alice') => fetch(new URL(`/_bedrock/files/${path}`, running.server.url), { ...init, headers: { ...identity.headers(user), ...init.headers } });
  return { ...running, temp, identity, request, call, async restart() { await running.stop(); running = await startPebble({ pebble, dir: temp.dir, dataDir: temp.dir, port: 0 }); }, async cleanup() { await running.stop(); temp.cleanup(); identity.restore(); } };
}

test('ctx storage tracks metadata, supports put/get/list/delete and cleans rollback/oversized streams', async () => {
  const f = await fixture();
  try {
    const file = (await f.execute('mutation', 'put', null, f.request())).value;
    expect(file.size).toBe(5); expect(file.sha256).toHaveLength(64);
    expect((await f.execute('query', 'list', null, f.request())).reads.has('_bedrock_files')).toBe(true);
    expect((await f.execute('query', 'list', null, f.request('bob'))).value).toEqual([]);
    await expect(f.execute('mutation', 'fail', null, f.request())).rejects.toThrow('rollback');
    await expect(f.execute('mutation', 'deleteFail', null, f.request())).rejects.toThrow('rollback');
    expect(await (await f.call(`attachments/${file.id}`)).text()).toBe('hello');
    expect(await readdir(join(f.temp.dir, 'files', 'attachments'))).toEqual([file.id]);
    await expect(f.execute('mutation', 'tooBig', null, f.request())).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(await readdir(join(f.temp.dir, 'files', 'tiny'))).toEqual([]);
    expect((await f.call('tiny', { method: 'POST', body: 'hi', headers: { 'content-type': 'image/png' } })).status).toBe(400);
    expect((await f.call(`attachments/${file.id}`, { method: 'DELETE' }, 'bob')).status).toBe(403);
    expect((await f.call(`attachments/${file.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await readdir(join(f.temp.dir, 'files', 'attachments'))).toEqual([]);
    await f.execute('mutation', 'put', null, f.request());
    await f.execute('mutation', 'put', null, f.request());
    const first = (await f.execute.storage('query', f.request(), ctx => ctx.storage.list(storage.attachments, { limit: 1, ownerId: 'alice' }))).value as any[];
    const next = (await f.execute.storage('query', f.request(), ctx => ctx.storage.list(storage.attachments, { cursor: first[0].id }))).value as any[];
    expect(first).toHaveLength(1); expect(next).toHaveLength(1); expect(first[0].id < next[0].id).toBe(true);
    expect((await f.execute.storage('query', f.request(), ctx => ctx.storage.list(storage.attachments, { ownerId: 'bob' }))).value).toEqual([]);
    await expect(f.execute.storage('query', f.request(), ctx => ctx.storage.put(storage.attachments, new Blob(), { name: 'readonly' }))).rejects.toMatchObject({ code: 'READ_ONLY' });
  } finally { await f.cleanup(); }
});

test('HTTP downloads enforce ownership, ranges, cache policy, ETags and safe HTML/SVG serving', async () => {
  const f = await fixture();
  try {
    const file = await (await f.call('attachments', { method: 'POST', body: '0123456789', headers: { 'content-type': 'text/plain', 'x-bedrock-file-name': 'sample.txt' } })).json();
    expect((await f.call(`attachments/${file.id}`, {}, 'bob')).status).toBe(403);
    const range = await f.call(`attachments/${file.id}`, { headers: { range: 'bytes=2-5' } });
    expect(range.status).toBe(206); expect(await range.text()).toBe('2345'); expect(range.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(range.headers.get('cache-control')).toBe('private, no-store');
    const suffix = await f.call(`attachments/${file.id}`, { headers: { range: 'bytes=-3' } }); expect(await suffix.text()).toBe('789');
    expect((await f.call(`attachments/${file.id}`, { headers: { range: 'bytes=100-' } })).status).toBe(416);
    expect((await f.call(`attachments/${file.id}`, { headers: { 'if-none-match': `"${file.sha256}"` } })).status).toBe(304);
    for (const mime of ['text/html', 'image/svg+xml']) {
      const unsafe = await (await f.call('public', { method: 'POST', body: '<script>alert(1)</script>', headers: { 'content-type': mime } })).json();
      const response = await f.call(`public/${unsafe.id}`);
      expect(response.headers.get('content-disposition')).toStartWith('attachment;');
      expect(response.headers.get('content-security-policy')).toBe('sandbox');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('cache-control')).toStartWith('public,');
    }
    const custom = await (await f.call('custom', { method: 'POST', body: 'custom' })).json();
    expect((await f.call(`custom/${custom.id}`, {}, 'bob')).status).toBe(403);
    expect((await f.call(`custom/${custom.id}`, {}, 'editor')).status).toBe(200);
    expect((await f.call(`custom/${custom.id}`, { method: 'DELETE' }, 'editor')).status).toBe(204);
    const usersFile = await (await f.call('users', { method: 'POST', body: 'shared' })).json();
    expect((await f.call(`users/${usersFile.id}`, {}, 'bob')).status).toBe(200);
    expect((await f.call(`users/${usersFile.id}`, { method: 'DELETE' }, 'bob')).status).toBe(403);
    expect((await fetch(new URL('/_bedrock/files/users', f.server.url), { method: 'POST', body: 'hi' })).status).toBe(401);
  } finally { await f.cleanup(); }
});

test('chunk uploads retry atomically, bind identity, survive restart, verify completion and prune old manifests', async () => {
  const f = await fixture();
  try {
    const bytes = new Uint8Array(CHUNK_SIZE + 3); bytes.fill(97);
    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const begin = async (sha = sha256) => (await f.call('attachments/uploads', { method: 'POST', body: JSON.stringify({ name: 'chunks', mime: 'text/plain', size: bytes.length, sha256: sha }) })).json();
    const { uploadId } = await begin();
    expect((await f.call(`attachments/uploads/${uploadId}/0`, { method: 'PUT', body: bytes.slice(0, CHUNK_SIZE) }, 'bob')).status).toBe(403);
    expect((await f.call(`attachments/uploads/${uploadId}/0`, { method: 'PUT', body: 'short' })).status).toBe(400);
    expect((await f.call(`attachments/uploads/${uploadId}/0`, { method: 'PUT', body: bytes.slice(0, CHUNK_SIZE) })).status).toBe(204);
    expect((await f.call(`attachments/uploads/${uploadId}/0`, { method: 'PUT', body: 'bad retry' })).status).toBe(400);
    expect((await f.call(`attachments/uploads/${uploadId}/complete`, { method: 'POST' })).status).toBe(400);
    expect((await f.call(`attachments/uploads/${uploadId}/1`, { method: 'PUT', body: bytes.slice(CHUNK_SIZE) })).status).toBe(204);
    await f.restart();
    const completion = await f.call(`attachments/uploads/${uploadId}/complete`, { method: 'POST' });
    expect(completion.status).toBe(201); const file = await completion.json(); expect(file.sha256).toBe(sha256);
    expect((await f.call(`attachments/${file.id}`)).headers.get('content-length')).toBe(String(bytes.length));
    const bad = await begin('0'.repeat(64));
    await f.call(`attachments/uploads/${bad.uploadId}/0`, { method: 'PUT', body: bytes.slice(0, CHUNK_SIZE) });
    await f.call(`attachments/uploads/${bad.uploadId}/1`, { method: 'PUT', body: bytes.slice(CHUNK_SIZE) });
    expect((await f.call(`attachments/uploads/${bad.uploadId}/complete`, { method: 'POST' })).status).toBe(400);
    expect(await readdir(join(f.temp.dir, 'files', 'attachments'))).toEqual([file.id]);
    const manifestPath = join(f.temp.dir, 'uploads', bad.uploadId, 'manifest.json');
    const manifest = await Bun.file(manifestPath).json(); manifest.createdAt = Date.now() - 86400001;
    await Bun.write(manifestPath, JSON.stringify(manifest));
    await begin();
    expect(await Bun.file(manifestPath).exists()).toBe(false);
  } finally { await f.cleanup(); }
});

test('SDK uploads and deletes files; subscribed storage list receives HTTP-upload invalidation', async () => {
  const f = await fixture();
  const client = createClient<typeof pebble>({ url: f.server.url.href, devUser: { id: 'alice' } });
  const values: any[] = [], errors: any[] = [], progress: number[] = [];
  const unsubscribe = client.subscribe('list', undefined, value => values.push(value), error => errors.push(error));
  async function until(predicate: () => boolean) { const deadline = Date.now() + 3000; while (!predicate()) { if (Date.now() > deadline) throw new Error('Sync timed out'); await Bun.sleep(10); } }
  try {
    await until(() => values.length > 0); expect(values[0]).toEqual([]);
    const file = await client.upload('attachments', new File(['sdk'], 'sdk.txt', { type: 'text/plain' }), { onProgress: value => progress.push(value) });
    await until(() => values.at(-1)?.length === 1);
    expect(values.at(-1)[0].id).toBe(file.id); expect(progress).toEqual([0, 1]); expect(errors).toEqual([]);
    expect(await (await f.call(`attachments/${file.id}`)).text()).toBe('sdk');
    await client.deleteFile('attachments', file.id); await until(() => values.at(-1)?.length === 0);
  } finally { unsubscribe(); client.close(); await f.cleanup(); }
});

test('SDK chooses chunking above 90 MB, retries a failed chunk, reports progress and verifies the final digest', async () => {
  const f = await fixture();
  const nativeFetch = globalThis.fetch;
  let chunkAttempts = 0;
  const progress: number[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    if (String(input).endsWith('/0') && init?.method === 'PUT' && ++chunkAttempts === 1) return Response.json({ error: { code: 'TEMPORARY_FAILURE', message: 'retry', hint: 'retry' } }, { status: 503 });
    return nativeFetch(input, init);
  }) as typeof fetch;
  const client = createClient<typeof pebble>({ url: f.server.url.href, sync: false, devUser: { id: 'alice' } });
  try {
    const bytes = new Uint8Array(90 * 1024 ** 2 + 1); bytes[0] = 42; bytes[bytes.length - 1] = 24;
    const file = await client.upload('attachments', new File([bytes], 'large.bin'), { onProgress: value => progress.push(value) });
    expect(chunkAttempts).toBe(2); expect(file.size).toBe(bytes.length);
    expect(file.sha256).toBe(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'));
    expect(progress).toEqual([0, CHUNK_SIZE / bytes.length, 2 * CHUNK_SIZE / bytes.length, 1]);
    const range = await f.call(`attachments/${file.id}`, { headers: { range: 'bytes=0-0' } });
    expect(new Uint8Array(await range.arrayBuffer())[0]).toBe(42);
  } finally { globalThis.fetch = nativeFetch; client.close(); await f.cleanup(); }
});


test('all server storage methods reject unregistered bucket objects with repair hints', async () => {
  const f = await fixture();
  try {
    for (const missing of [bucket('missing', { maxSize: 1, access: 'public' }), bucket('attachments', { maxSize: 1, access: 'public' })]) {
      for (const handler of [
        (ctx: import('../src/config').FunctionContext) => ctx.storage.get(missing, 'id'),
        (ctx: import('../src/config').FunctionContext) => ctx.storage.list(missing),
        (ctx: import('../src/config').FunctionContext) => ctx.storage.delete(missing, 'id'),
        (ctx: import('../src/config').FunctionContext) => ctx.storage.put(missing, new Blob(), { name: 'test' }),
      ]) {
        await expect(f.execute.storage('mutation', f.request(), handler)).rejects.toMatchObject({ code: 'UNKNOWN_BUCKET', hint: 'Add this exact bucket object to definePebble({ storage: [bucket] }).' });
      }
    }
  } finally { await f.cleanup(); }
});
