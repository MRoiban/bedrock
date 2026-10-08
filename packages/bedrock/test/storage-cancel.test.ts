import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { bucket, definePebble } from '../src/config';
import { startPebble } from '../src/runtime';
import { createFileHandler } from '../src/storage/http';
import { createClient } from '../src/client';
import { tempDirectory } from './helpers';
import { storageIdentity } from './storage-identity';

async function fixture(onStored?: Parameters<typeof bucket>[1]['onStored']) {
  const temp = tempDirectory(), identity = storageIdentity();
  const assets = bucket('assets', { access: 'owner', maxSize: 100, ...(onStored ? { onStored } : {}) });
  const other = bucket('other', { access: 'owner', maxSize: 100 });
  const pebble = definePebble({ name: 'cancel', storage: [assets, other] });
  const running = await startPebble({ pebble, dir: temp.dir, dataDir: temp.dir, port: 0 });
  const handler = createFileHandler(pebble, running.execute, join(temp.dir, 'uploads'));
  const call = (path: string, init: RequestInit = {}, user = 'alice', bucketName = 'assets') => handler.handle(new Request(`http://localhost/_bedrock/files/${bucketName}${path}`, { ...init, headers: { ...identity.headers(user), ...init.headers } }));
  const start = async () => (await (await call('/uploads', { method: 'POST', body: JSON.stringify({ name: 'unfinished', size: 5 }) })).json()).uploadId as string;
  const client = createClient<typeof pebble>({ url: running.server.url.href, sync: false, headers: identity.headers('alice') });
  return { ...running, temp, call, start, client, async cleanup() { client.close(); await running.stop(); identity.restore(); temp.cleanup(); } };
}
function gate() {
  let release!: () => void, enter!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { enter = resolve; });
  return { release, enter, wait, ready };
}

test('cancellation removes all upload files, binds user/bucket, and repeats as UPLOAD_NOT_FOUND', async () => {
  const f = await fixture();
  try {
    const id = await f.start(), path = `/uploads/${id}`;
    expect((await f.call(path + '/0', { method: 'PUT', body: 'hello' })).status).toBe(204);
    expect((await fetch(new URL('/_bedrock/files/assets' + path, f.server.url), { method: 'DELETE' })).status).toBe(403);
    expect((await f.call(path, { method: 'DELETE' }, 'bob')).status).toBe(403);
    expect((await f.call(path, { method: 'DELETE' }, 'alice', 'other')).status).toBe(403);
    expect(await readdir(join(f.temp.dir, 'uploads', id))).toEqual(['0', 'manifest.json']);
    expect((await f.call(path, { method: 'DELETE' })).status).toBe(204);
    expect(await Bun.file(join(f.temp.dir, 'uploads', id, 'manifest.json')).exists()).toBe(false);
    expect((await readdir(join(f.temp.dir, 'uploads'))).includes(id)).toBe(false);
    const retry = await f.call(path, { method: 'DELETE' });
    expect(retry.status).toBe(404);
    expect((await retry.json()).error.code).toBe('UPLOAD_NOT_FOUND');
    expect((await f.call(path + '/0', { method: 'PUT', body: 'hello' })).status).toBe(404);
    expect((await f.call(path + '/complete', { method: 'POST' })).status).toBe(404);
    // The SDK accepts already-gone handles for safe cleanup retries.
    await f.client.cancelUpload('assets', id);
    await f.client.cancelUpload('assets', id);
  } finally { await f.cleanup(); }
});
test('DELETE waits for an active chunk writer before removing manifest and chunks', async () => {
  const f = await fixture(), g = gate();
  try {
    const id = await f.start(), path = `/uploads/${id}`;
    const body = new ReadableStream<Uint8Array>({ async pull(controller) { controller.enqueue(new TextEncoder().encode('hello')); g.enter(); await g.wait; controller.close(); } }, { highWaterMark: 0 });
    const writer = f.call(path + '/0', { method: 'PUT', body });
    await g.ready;
    let cancelled = false;
    const cancel = f.call(path, { method: 'DELETE' }).then(response => { cancelled = true; return response; });
    await Bun.sleep(20);
    expect(cancelled).toBe(false);
    expect(await Bun.file(join(f.temp.dir, 'uploads', id, 'manifest.json')).exists()).toBe(true);
    g.release();
    expect((await writer).status).toBe(204);
    expect((await cancel).status).toBe(204);
    expect((await readdir(join(f.temp.dir, 'uploads'))).includes(id)).toBe(false);
    expect((await readdir(join(f.temp.dir, 'files', 'assets')).catch(() => [])).length).toBe(0);
  } finally { g.release(); await f.cleanup(); }
});
test('completion winning a cancellation race preserves the committed file', async () => {
  const g = gate();
  const f = await fixture(async () => { g.enter(); await g.wait; });
  try {
    const id = await f.start(), path = `/uploads/${id}`;
    await f.call(path + '/0', { method: 'PUT', body: 'hello' });
    const complete = f.call(path + '/complete', { method: 'POST' });
    await g.ready;
    const cancel = f.call(path, { method: 'DELETE' });
    g.release();
    const completed = await complete;
    expect(completed.status).toBe(201);
    const file = await completed.json();
    expect((await cancel).status).toBe(404);
    expect(await (await f.call('/' + file.id)).text()).toBe('hello');
    expect(await readdir(join(f.temp.dir, 'files', 'assets'))).toEqual([file.id]);
    expect((await readdir(join(f.temp.dir, 'uploads'))).includes(id)).toBe(false);
    expect(await readdir(join(f.temp.dir, 'uploads', 'staging'))).toEqual([]);
  } finally { g.release(); await f.cleanup(); }
});
test('cancellation winning a completion race leaves no completed file or upload', async () => {
  const f = await fixture(), g = gate();
  try {
    const id = await f.start(), path = `/uploads/${id}`;
    const body = new ReadableStream<Uint8Array>({ async pull(controller) { controller.enqueue(new TextEncoder().encode('hello')); g.enter(); await g.wait; controller.close(); } }, { highWaterMark: 0 });
    const writer = f.call(path + '/0', { method: 'PUT', body });
    await g.ready;
    const cancel = f.call(path, { method: 'DELETE' });
    await Bun.sleep(20);
    const complete = f.call(path + '/complete', { method: 'POST' });
    await Bun.sleep(20);
    g.release();
    expect((await writer).status).toBe(204);
    expect((await cancel).status).toBe(204);
    expect((await complete).status).toBe(404);
    expect((await readdir(join(f.temp.dir, 'files', 'assets')).catch(() => [])).length).toBe(0);
    expect((await readdir(join(f.temp.dir, 'uploads'))).includes(id)).toBe(false);
  } finally { g.release(); await f.cleanup(); }
});
test('SDK explicit cancellation and abort with resumed/new handles remove server uploads', async () => {
  const f = await fixture();
  try {
    const explicit = await f.start();
    await f.client.cancelUpload('assets', explicit);
    expect((await f.call(`/uploads/${explicit}`)).status).toBe(404);
    const resumed = await f.start(), aborted = new AbortController();
    aborted.abort();
    await expect(f.client.upload('assets', new File(['hello'], 'hello'), { uploadId: resumed, signal: aborted.signal })).rejects.toThrow();
    expect((await f.call(`/uploads/${resumed}`)).status).toBe(404);
    const controller = new AbortController();
    let created = '';
    await expect(f.client.upload('assets', new File(['hello'], 'hello'), { uploadId: resumed, signal: controller.signal, onUploadId(id) { created = id; controller.abort(); } })).rejects.toThrow();
    expect(created).not.toBe(resumed);
    expect(created).not.toBe('');
    expect((await f.call(`/uploads/${created}`)).status).toBe(404);
  } finally { await f.cleanup(); }
});
test('SDK transient disconnect preserves a received chunk for resume and never sends DELETE', async () => {
  const f = await fixture(), original = globalThis.fetch;
  const calls: string[] = [];
  let disconnect = true;
  try {
    const id = await f.start();
    globalThis.fetch = (async (input: URL, init: RequestInit) => {
      calls.push(init.method!);
      if (disconnect && String(input).endsWith('/complete')) throw new Error('disconnected');
      return original(input, init);
    }) as typeof fetch;
    await expect(f.client.upload('assets', new File(['hello'], 'hello'), { uploadId: id })).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    expect((await (await f.call(`/uploads/${id}`)).json()).received).toEqual([0]);
    expect(calls).not.toContain('DELETE');
    disconnect = false;
    calls.length = 0;
    const file = await f.client.upload('assets', new File(['hello'], 'hello'), { uploadId: id });
    expect(calls).toEqual(['GET', 'POST']);
    expect(file.size).toBe(5);
    expect(await (await f.call('/' + file.id)).text()).toBe('hello');
  } finally { globalThis.fetch = original; await f.cleanup(); }
});
