import { test, expect } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fsDriver } from './driver';
import { tempDirectory } from '../../test/helpers';
test('filesystem driver atomically replaces files, handles ranges, and rejects traversal', async () => {
  const temp = tempDirectory(), driver = fsDriver(temp.dir);
  try {
    await driver.put('bucket/id', new Blob(['original']));
    await expect(driver.put('bucket/id', new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('partial')); c.error(new Error('interrupted')); } }))).rejects.toThrow('interrupted');
    expect(await driver.get('bucket/id').text()).toBe('original');
    expect(await driver.get('bucket/id', { start: 1, end: 3 }).text()).toBe('rig');
    expect(await driver.stat('bucket/id')).toEqual({ size: 8 });
    expect(await readdir(join(temp.dir, 'bucket'))).toEqual(['id']);
    expect(() => driver.get('../escape')).toThrow();
    await driver.delete('bucket/id'); expect(await driver.stat('bucket/id')).toBeNull();
  } finally { temp.cleanup(); }
});
