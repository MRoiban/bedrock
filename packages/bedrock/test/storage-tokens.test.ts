import { expect, test } from 'bun:test';
import * as v from 'valibot';
import { join } from 'node:path';
import { bucket, definePebble, mutation, type FunctionContext } from '../src/config';
import { startPebble } from '../src/runtime';
import { createFileHandler } from '../src/storage/http';
import { tempDirectory } from './helpers';

const alice = { id: 'alice', email: 'alice@example.test', name: 'Alice' };
async function fixture(hooks: Pick<Parameters<typeof bucket>[1], 'admit' | 'onStored'> = {}) {
  const temp = tempDirectory();
  const assets = bucket('assets', { access: 'owner', maxSize: 100, ...hooks });
  const pebble = definePebble({ name: 'storage-tokens', tokens: true, access: 'users', storage: [assets],
    mutations: { mint: mutation(v.array(v.string()), (ctx, permissions) => ctx.tokens.create({ name: 'upload', permissions })) },
  });
  const runtime = await startPebble({ pebble, dir: temp.dir, dataDir: temp.dir, port: 0 });
  const handler = createFileHandler(pebble, runtime.execute, join(temp.dir, 'uploads'));
  const mint = async (permissions: string[]) => (await runtime.execute('mutation', 'mint', permissions, new Request('http://localhost'), { user: alice })).value;
  const request = (token: string, path: string, method = 'GET', body?: BodyInit, headers?: HeadersInit) =>
    new Request(`http://localhost/_bedrock/files/assets${path}`, { method, ...(body === undefined ? {} : { body }), headers: { authorization: `Bearer ${token}`, ...headers } });
  return { ...runtime, mint, request, call: (token: string, path: string, method = 'GET', body?: BodyInit) => handler.handle(request(token, path, method, body)),
    handler, async cleanup() { await runtime.stop(); temp.cleanup(); } };
}

test('storage tokens enforce upload/read/delete permissions on every single and chunk path', async () => {
  const f = await fixture();
  try {
    const read = await f.mint(['files:assets:read']), upload = await f.mint(['files:assets:upload']), del = await f.mint(['files:assets:delete']);
    const startBody = JSON.stringify({ name: 'chunk', size: 5 });
    for (const path of ['', '/uploads']) expect((await f.call(read.token, path, 'POST', path ? startBody : 'hello')).status).toBe(403);
    const start = await f.call(upload.token, '/uploads', 'POST', startBody);
    expect(start.status).toBe(201);
    const { uploadId } = await start.json(), path = `/uploads/${uploadId}`;
    for (const [suffix, method, body] of [['/0', 'PUT', 'hello'], ['', 'GET', undefined], ['', 'DELETE', undefined], ['/complete', 'POST', undefined]] as const) {
      const denied = await f.call(read.token, path + suffix, method, body);
      expect(denied.status).toBe(403);
      expect((await denied.json()).error.hint).toContain('files:assets:upload');
    }
    expect((await f.call(del.token, path, 'DELETE')).status).toBe(403);
    expect((await f.call(upload.token, path + '/0', 'PUT', 'hello')).status).toBe(204);
    expect((await (await f.call(upload.token, path)).json()).received).toEqual([0]);
    const complete = await f.call(upload.token, path + '/complete', 'POST');
    expect(complete.status).toBe(201);
    const chunkFile = await complete.json();
    const single = await f.call(upload.token, '', 'POST', 'hello');
    expect(single.status).toBe(201);
    const singleFile = await single.json();
    for (const file of [singleFile, chunkFile]) {
      for (const method of ['GET', 'HEAD']) {
        expect((await f.call(upload.token, '/' + file.id, method)).status).toBe(403);
        expect((await f.call(read.token, '/' + file.id, method)).status).toBe(200);
      }
      expect((await f.call(read.token, '/' + file.id, 'DELETE')).status).toBe(403);
      expect((await f.call(del.token, '/' + file.id, 'DELETE')).status).toBe(204);
    }
    for (const kind of ['query', 'mutation'] as const) {
      const request = f.request(read.token, '', 'POST', 'hello');
      const identity = await f.execute.identify(request);
      let entered = false;
      await expect(f.execute.storage(kind, request, () => { entered = true; }, identity)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(entered).toBe(false);
    }
  } finally { await f.cleanup(); }
});

test('staged upload hooks retain the same token and user in authorize and commit slots', async () => {
  const seen: { hook: string; user: FunctionContext['user']; token: FunctionContext['token']; meta: unknown }[] = [];
  const record = (hook: string, ctx: FunctionContext, meta: unknown) => { seen.push({ hook, user: ctx.user, token: ctx.token, meta }); };
  const f = await fixture({ admit: (ctx, file) => record('admit', ctx, file.meta), onStored: (ctx, _file, meta) => record('stored', ctx, meta) });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const body = new ReadableStream<Uint8Array>({ async pull(controller) {
    controller.enqueue(new TextEncoder().encode('hello')); entered(); await wait; controller.close();
  } }, { highWaterMark: 0 });
  try {
    const upload = await f.mint(['files:assets:upload']);
    const meta = { via: 'native' };
    const pending = f.handler.handle(f.request(upload.token, '', 'POST', body, { 'x-bedrock-file-meta': encodeURIComponent(JSON.stringify(meta)) }));
    await ready;
    // A concurrent update must not replace the identity of an in-flight request.
    await f.execute.job(ctx => ctx.db.$client.query('UPDATE _bedrock_tokens SET user_json = ? WHERE id = ?').run(JSON.stringify({ ...alice, name: 'Changed' }), upload.id));
    release();
    expect((await pending).status).toBe(201);
    expect(seen.map(entry => entry.hook)).toEqual(['admit', 'admit', 'stored']);
    for (const entry of seen) {
      expect(entry.user).toEqual(alice);
      expect(entry.token).toEqual({ id: upload.id, name: 'upload', permissions: ['files:assets:upload'] });
      expect(entry.meta).toEqual(meta);
      expect(entry.user).toBe(seen[0]!.user);
      expect(entry.token).toBe(seen[0]!.token);
    }
    seen.length = 0;
    const start = await (await f.call(upload.token, '/uploads', 'POST', JSON.stringify({ name: 'chunk', size: 5, meta }))).json();
    expect((await f.call(upload.token, `/uploads/${start.uploadId}/0`, 'PUT', 'hello')).status).toBe(204);
    expect((await f.call(upload.token, `/uploads/${start.uploadId}/complete`, 'POST')).status).toBe(201);
    expect(seen.map(entry => entry.hook)).toEqual(['admit', 'admit', 'stored']);
    for (const entry of seen) { expect(entry.token?.id).toBe(upload.id); expect(entry.meta).toEqual(meta); }
  } finally { release(); await f.cleanup(); }
});
