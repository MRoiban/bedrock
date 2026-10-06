import { expect, test } from 'bun:test';
import { definePebble, bucket } from '../config';
import { BedrockError } from '../error';
import { sizeBytes } from './config';
test('bucket and definePebble validate sizes, policies, names and MIME patterns with hints', () => {
  expect(sizeBytes('50mb')).toBe(50 * 1024 ** 2); expect(sizeBytes(100)).toBe(100);
  for (const config of [{ maxSize: 'wat', access: 'owner' }, { maxSize: 0, access: 'public' }, { maxSize: 5, access: 'bad' }, { maxSize: 5, access: 'public', accept: ['image'] }]) {
    for (const make of [() => bucket('files', config as any), () => definePebble({ name: 'test', storage: [{ name: 'files', ...config } as any] })]) {
      try { make(); throw new Error('Expected invalid bucket'); }
      catch (error) { expect(error).toBeInstanceOf(BedrockError); expect((error as BedrockError).hint.length).toBeGreaterThan(0); }
    }
  }
  for (const name of ['', '../escape', 'Upper', 'a'.repeat(33)]) {
    expect(() => bucket(name, { maxSize: 1, access: 'public' })).toThrow(BedrockError);
  }
  for (const name of ['a', '1', '_', '-', 'my-files_2', 'a'.repeat(32)]) {
    expect(bucket(name, { maxSize: 1, access: 'public' }).name).toBe(name);
  }
  const files = bucket('files', { maxSize: 1, access: 'public' });
  expect(() => definePebble({ name: 'test', storage: [files, files] })).toThrow('Duplicate');
  expect(() => definePebble({ name: 'test', storage: [files, bucket('files', files)] })).toThrow('Duplicate');
  expect(() => definePebble({ name: 'test', storage: { files } as any })).toThrow(BedrockError);
});
