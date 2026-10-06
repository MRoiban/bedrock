import { test, expect } from 'bun:test';
import { bucket, definePebble, query, mutation } from '../config';
import { createClient } from '../client';
const storage = { attachments: bucket({ maxSize: '1mb', access: 'owner' }) };
const pebble = definePebble({ name: 'typed-storage', storage, queries: {
  files: query(storage, ctx => {
    // @ts-expect-error Unknown buckets must not typecheck.
    ctx.storage.missing;
    return ctx.storage.attachments.list();
  }),
  unbound: query(ctx => {
    // @ts-expect-error Bind storage to get bucket keys.
    ctx.storage.attachments;
    return null;
  }),
}, mutations: { put: mutation(storage, ctx => ctx.storage.attachments.put(new Blob(), { name: 'test' })) } });
function checkClient() {
  const client = createClient<typeof pebble>({ url: 'http://localhost' });
  client.fileUrl('attachments', 'id');
  // @ts-expect-error Unknown SDK buckets must not typecheck.
  client.fileUrl('missing', 'id');
  // @ts-expect-error Unknown SDK buckets must not typecheck.
  client.upload('missing', new File([], 'file'));
}
void checkClient;
test('storage registry preserves bucket keys', () => expect(Object.keys(pebble.storage)).toEqual(['attachments']));
