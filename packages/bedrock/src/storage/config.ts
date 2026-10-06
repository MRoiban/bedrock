import type { Bucket } from '../config/types';
import { BedrockError } from '../error';
export const storageError = (code: string, message: string, hint = 'Check the bucket configuration, file metadata, and upload protocol.') => new BedrockError(code, message, hint);
export function sizeBytes(value: string | number): number {
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(value) : null;
  const size = typeof value === 'number' ? value : match ? Number(match[1]) * ({ b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[match[2]!.toLowerCase()]!) : NaN;
  if (!Number.isSafeInteger(size) || size <= 0) throw storageError('INVALID_BUCKET', 'maxSize must be positive bytes or a size such as "50mb".');
  return size;
}
export function validateBucket(config: Bucket) {
  if (!config || typeof config !== 'object') throw storageError('INVALID_BUCKET', 'Use bucket(name, { maxSize, access, accept? }).');
  const name = config.name;
  if (typeof name !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(name)) throw storageError('INVALID_BUCKET', 'Bucket names need 1–32 lowercase letters, digits, underscores, or hyphens.');
  sizeBytes(config.maxSize);
  if (!['public', 'users', 'owner'].includes(config.access as string) && typeof config.access !== 'function') throw storageError('INVALID_BUCKET', `Invalid access for ${name}; use public, users, owner, or a policy function.`);
  if (config.accept !== undefined && (!Array.isArray(config.accept) || !config.accept.every(m => typeof m === 'string' && /^[\w.+-]+\/(?:[\w.+-]+|\*)$/.test(m)))) throw storageError('INVALID_BUCKET', 'accept must contain MIME patterns such as image/* .');
}
export function validateBuckets(buckets: readonly Bucket[] = []) {
  if (!Array.isArray(buckets)) throw storageError('INVALID_BUCKET', 'Register buckets with storage: [attachments].');
  const names = new Set<string>();
  for (const config of buckets) {
    validateBucket(config);
    if (names.has(config.name)) throw storageError('INVALID_BUCKET', `Duplicate bucket name: ${config.name}; give each registered bucket a unique name.`);
    names.add(config.name);
  }
}
export function fileInfo(name: string, mime = 'application/octet-stream') {
  if (typeof name !== 'string' || !name || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) throw storageError('INVALID_FILE', 'Provide a filename of 1–255 characters without control characters.');
  mime = mime.split(';')[0]!.trim().toLowerCase();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) throw storageError('INVALID_FILE', 'Provide a valid MIME type.');
  return { name, mime };
}
