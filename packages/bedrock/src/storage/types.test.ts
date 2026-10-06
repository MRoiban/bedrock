import { test, expect } from 'bun:test';
import * as v from 'valibot';
import { bucket, definePebble, query, mutation, type BucketNames } from '../config';
import { createClient } from '../client';
import { useUpload } from '../react';
const attachments = bucket('attachments', { maxSize: '1mb', access: 'owner' });
const pebble = definePebble({ name: 'typed-storage', storage: [attachments], queries: {
  files: query(ctx => ctx.storage.list(attachments)),
  filtered: query(v.object({ ownerId: v.string() }), (ctx, args) => ctx.storage.list(attachments, args)),
}, mutations: {
  put: mutation(ctx => ctx.storage.put(attachments, new Blob(), { name: 'test' })),
  remove: mutation(v.string(), (ctx, id) => ctx.storage.delete(attachments, id)),
} });
function checkTypes() {
  const client = createClient<typeof pebble>({ url: 'http://localhost' });
  const name: BucketNames<typeof pebble> = 'attachments';
  client.fileUrl(name, 'id');
  client.upload(name, new File([], 'file'));
  client.deleteFile(name, 'id');
  useUpload<typeof pebble>(name);
  // @ts-expect-error Unknown SDK buckets must not typecheck.
  client.fileUrl('missing', 'id');
  // @ts-expect-error Unknown SDK buckets must not typecheck.
  client.upload('missing', new File([], 'file'));
  // @ts-expect-error Unknown SDK buckets must not typecheck.
  client.deleteFile('missing', 'id');
  // @ts-expect-error Unknown hook buckets must not typecheck.
  useUpload<typeof pebble>('missing');
  // @ts-expect-error Clients accept names, not server bucket objects.
  client.upload(attachments, new File([], 'file'));
  // @ts-expect-error Storage requires bucket objects, not names.
  query(ctx => ctx.storage.list('attachments'));
  // @ts-expect-error query has no storage-registry overload.
  query([attachments], () => null);
  // @ts-expect-error mutation has no storage-registry overload.
  mutation([attachments], () => null);
  // @ts-expect-error query accepts at most two arguments.
  query([attachments], v.string(), () => null);
  // @ts-expect-error mutation accepts at most two arguments.
  mutation([attachments], v.string(), () => null);
}
void checkTypes;
test('storage array preserves literal bucket names and both function signatures', () => {
  expect(pebble.storage.map(value => value.name)).toEqual(['attachments']);
  expect(pebble.queries.files.schema).toBeUndefined();
  expect(pebble.queries.filtered.schema).toBeDefined();
  expect(pebble.mutations.put.schema).toBeUndefined();
  expect(pebble.mutations.remove.schema).toBeDefined();
});
