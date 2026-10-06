import { expect, test } from 'bun:test';
import { Sha256 } from './sha256';
test('incremental SHA-256 matches Web Crypto across unaligned random chunks', async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 1000, 65536]) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    for (const stride of [1, 7, 63, 64, 65, 131]) {
      const hash = new Sha256();
      for (let i = 0; i < size; i += stride) hash.update(bytes.subarray(i, i + stride));
      expect(hash.digest()).toBe(expected); expect(hash.digest()).toBe(expected);
    }
  }
});
