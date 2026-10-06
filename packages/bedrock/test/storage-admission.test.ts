import { expect, test } from 'bun:test';
import { readdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { bucket, definePebble, query, mutation } from '../src/config';
import { BedrockError } from '../src/error';
import { startPebble } from '../src/runtime';
import { createFileHandler } from '../src/storage/http';
import { files } from '../src/storage/schema';
import { tempDirectory } from './helpers';
import { cleanupStaging } from '../src/storage/staging';

async function fixture(config: Parameters<typeof bucket>[1]) {
  const temp = tempDirectory();
  const assets = bucket('assets', config);
  const pebble = definePebble({ name: 'admission', storage: [assets], queries: { count: query(({ db }) => db.select().from(files).all().length) }, mutations: { ping: mutation(() => 'pong') } });
  const running = await startPebble({ pebble, dir: temp.dir, dataDir: temp.dir, port: 0 });
  const handler = createFileHandler(pebble, running.execute, join(temp.dir, 'uploads'));
  const call = (path = '', init: RequestInit = {}) => handler.handle(new Request(`http://localhost/_bedrock/files/assets${path}`, init));
  return { ...running, temp, handler, assets, call, async cleanup() { await running.stop(); temp.cleanup(); } };
}
function stalled() {
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const body = new ReadableStream<Uint8Array>({ async pull(controller) { controller.enqueue(new TextEncoder().encode('hello')); entered(); await wait; controller.close(); } }, { highWaterMark: 0 });
  return { body, ready, release };
}
async function short<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Executor blocked by upload')), 1000); })]); }
  finally { clearTimeout(timer!); }
}
for (const chunk of [false, true]) test(`stalled ${chunk ? 'chunk' : 'single'} body leaves executor free for queries and mutations`, async () => {
  const f = await fixture({ maxSize: 100, access: 'public' });
  const stream = stalled();
  try {
    const start = chunk ? await (await f.call('/uploads', { method: 'POST', body: JSON.stringify({ name: 'test', size: 5 }) })).json() : undefined;
    let settled = false;
    const pending = f.call(chunk ? `/uploads/${start.uploadId}/0` : '', { method: chunk ? 'PUT' : 'POST', body: stream.body }).then(value => { settled = true; return value; });
    await stream.ready;
    const request = new Request('http://localhost');
    expect((await short(f.execute('query', 'count', null, request))).value).toBe(0);
    expect((await short(f.execute('mutation', 'ping', null, request))).value).toBe('pong');
    expect(settled).toBe(false);
    stream.release();
    expect((await pending).status).toBe(chunk ? 204 : 201);
    if (chunk) expect((await f.call(`/uploads/${start.uploadId}/complete`, { method: 'POST' })).status).toBe(201);
    expect((await f.execute('query', 'count', null, request)).value).toBe(1);
  } finally { stream.release(); await f.cleanup(); }
});

test('admission rejects declarations before consuming bytes and serializes commit quota checks', async () => {
  const f = await fixture({ maxSize: 100, access: 'public', admit: ({ db }, file) => {
    const used = db.select().from(files).all().reduce((sum, row) => sum + row.size, 0);
    if (file.size !== null && used + file.size > 5) throw new BedrockError('QUOTA_EXCEEDED', 'Your safe is full.', 'Delete files.');
  } });
  try {
    const rejected = await f.call('', { method: 'POST', body: '123456', headers: { 'content-length': '6' } });
    expect(await rejected.json()).toMatchObject({ error: { code: 'QUOTA_EXCEEDED', hint: 'Delete files.' } });
    expect((await f.call('/uploads', { method: 'POST', body: JSON.stringify({ name: 'large', size: 6 }) })).status).toBe(400);
    const a = stalled(), b = stalled();
    const pending = [f.call('', { method: 'POST', body: a.body }), f.call('', { method: 'POST', body: b.body })];
    await Promise.all([a.ready, b.ready]);
    a.release(); b.release();
    const responses = await Promise.all(pending);
    expect(responses.map(r => r.status).sort()).toEqual([201, 400]);
    expect(await responses.find(r => r.status === 400)!.json()).toMatchObject({ error: { code: 'QUOTA_EXCEEDED' } });
    expect(await readdir(join(f.temp.dir, 'files', 'assets'))).toHaveLength(1);
    expect(await readdir(join(f.temp.dir, 'uploads', 'staging'))).toEqual([]);
  } finally { await f.cleanup(); }
});

test('onStored failure rolls back app writes, file metadata and adopted bytes', async () => {
  const f = await fixture({ maxSize: 100, access: 'public', onStored: ({ db }) => {
    db.$client.exec('CREATE TABLE rejected (id TEXT)');
    throw new BedrockError('REJECTED', 'Rejected by app.', 'Try again.');
  } });
  try {
    const response = await f.call('', { method: 'POST', body: 'hello' });
    expect(await response.json()).toMatchObject({ error: { code: 'REJECTED' } });
    expect((await f.execute('query', 'count', null, new Request('http://localhost'))).value).toBe(0);
    expect(await readdir(join(f.temp.dir, 'files', 'assets'))).toEqual([]);
    expect(await readdir(join(f.temp.dir, 'uploads', 'staging'))).toEqual([]);
    await f.execute.storage('query', new Request('http://localhost'), ctx => expect(ctx.db.$client.query("SELECT name FROM sqlite_master WHERE name='rejected'").get()).toBeNull());
  } finally { await f.cleanup(); }
});

test('metadata reaches both hooks through single, chunked and server puts; late digest and status work', async () => {
  const seen: unknown[] = [];
  const f = await fixture({ maxSize: 100, access: 'public', admit: (_ctx, file) => { seen.push(file.meta); }, onStored: (_ctx, _file, meta) => { seen.push(meta); } });
  const meta = { folder: 'photos', label: 'été' };
  try {
    expect((await f.call('', { method: 'POST', body: 'hello', headers: { 'x-bedrock-file-meta': encodeURIComponent(JSON.stringify(meta)) } })).status).toBe(201);
    const start = await (await f.call('/uploads', { method: 'POST', body: JSON.stringify({ name: 'chunk', size: 5, meta }) })).json();
    expect(await (await f.call(`/uploads/${start.uploadId}`)).json()).toEqual({ uploadId: start.uploadId, size: 5, chunkSize: 32 * 1024 ** 2, received: [] });
    expect((await f.call(`/uploads/${start.uploadId}/0`, { method: 'PUT', body: 'hello' })).status).toBe(204);
    expect((await (await f.call(`/uploads/${start.uploadId}`)).json()).received).toEqual([0]);
    const complete = (sha256: string) => f.call(`/uploads/${start.uploadId}/complete`, { method: 'POST', body: JSON.stringify({ sha256 }) });
    expect(await (await complete('0'.repeat(64))).json()).toMatchObject({ error: { code: 'UPLOAD_CHECKSUM_MISMATCH' } });
    expect(await readdir(join(f.temp.dir, 'uploads', 'staging'))).toEqual([]);
    expect((await complete(new Bun.CryptoHasher('sha256').update('hello').digest('hex'))).status).toBe(201);
    await f.execute.storage('mutation', new Request('http://localhost'), ctx => ctx.storage.put(f.assets, new Blob(['hello']), { name: 'server', meta }));
    expect(seen).toEqual(Array(9).fill(meta));
    expect((await f.call('', { method: 'POST', body: 'x', headers: { 'x-bedrock-file-meta': '%not-json' } })).status).toBe(400);
    expect((await f.call('', { method: 'POST', body: 'x', headers: { 'x-bedrock-file-meta': 'x'.repeat(4097) } })).status).toBe(400);
  } finally { await f.cleanup(); }
});

test('staging cleanup removes stale files and preserves recent files', async () => {
  const temp = tempDirectory();
  try {
    const old = join(temp.dir, 'staging', 'old'), fresh = join(temp.dir, 'staging', 'fresh');
    await Bun.write(old, 'old'); await Bun.write(fresh, 'fresh');
    const timestamp = new Date(Date.now() - 86400001); await utimes(old, timestamp, timestamp);
    await cleanupStaging(temp.dir);
    expect(await readdir(join(temp.dir, 'staging'))).toEqual(['fresh']);
  } finally { temp.cleanup(); }
});

test('disconnect and body errors remove single-upload staging and partial chunk replacements', async () => {
  const f = await fixture({ maxSize: 100, access: 'public' });
  try {
    const controller = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const body = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array([1])); entered(); return new Promise<void>(() => {}); } }, { highWaterMark: 0 });
    const pending = f.call('', { method: 'POST', body, signal: controller.signal });
    await ready; controller.abort();
    expect((await short(pending)).status).toBe(500);
    expect(await readdir(join(f.temp.dir, 'uploads', 'staging'))).toEqual([]);
    const start = await (await f.call('/uploads', { method: 'POST', body: JSON.stringify({ name: 'chunk', size: 5 }) })).json();
    expect((await f.call(`/uploads/${start.uploadId}/0`, { method: 'PUT', body: 'hello' })).status).toBe(204);
    const failed = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); c.error(new Error('disconnected')); } });
    expect((await f.call(`/uploads/${start.uploadId}/0`, { method: 'PUT', body: failed })).status).toBe(500);
    expect(await readdir(join(f.temp.dir, 'uploads', start.uploadId))).toEqual(['0', 'manifest.json']);
    expect((await f.call(`/uploads/${start.uploadId}/complete`, { method: 'POST' })).status).toBe(201);
  } finally { await f.cleanup(); }
});

test('different uploads can stream concurrently while one chunk is stalled', async () => {
  const f = await fixture({ maxSize: 100, access: 'public' });
  const stream = stalled();
  try {
    const start = async () => (await f.call('/uploads', { method: 'POST', body: JSON.stringify({ name: 'chunk', size: 5 }) })).json();
    const a = await start(), b = await start();
    const pending = f.call(`/uploads/${a.uploadId}/0`, { method: 'PUT', body: stream.body });
    await stream.ready;
    expect((await short(f.call(`/uploads/${b.uploadId}/0`, { method: 'PUT', body: 'hello' }))).status).toBe(204);
    stream.release(); expect((await pending).status).toBe(204);
  } finally { stream.release(); await f.cleanup(); }
});
