import { expect, test } from 'bun:test';
import { definePebble, bucket } from '../config';
import { sizeBytes } from './config';
test('definePebble validates bucket sizes, policies, keys and MIME patterns with hints', () => {
  expect(sizeBytes('50mb')).toBe(50 * 1024 ** 2); expect(sizeBytes(100)).toBe(100);
  for (const config of [{ maxSize: 'wat', access: 'owner' }, { maxSize: 0, access: 'public' }, { maxSize: 5, access: 'bad' }, { maxSize: 5, access: 'public', accept: ['image'] }]) {
    expect(() => definePebble({ name: 'test', storage: { files: config as any } })).toThrow();
  }
  expect(() => definePebble({ name: 'test', storage: { '../escape': bucket({ maxSize: 1, access: 'public' }) } })).toThrow();
});
