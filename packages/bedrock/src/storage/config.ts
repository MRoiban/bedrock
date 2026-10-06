import type { BucketConfig } from '../config/types';
import { BedrockError } from '../error';
export const storageError = (code: string, message: string) => new BedrockError(code, message, 'Check the bucket configuration, file metadata, and upload protocol.');
export function sizeBytes(value: string | number): number {
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(value) : null;
  const size = typeof value === 'number' ? value : match ? Number(match[1]) * ({ b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[match[2]!.toLowerCase()]!) : NaN;
  if (!Number.isSafeInteger(size) || size <= 0) throw storageError('INVALID_BUCKET', 'maxSize must be positive bytes or a size such as "50mb".');
  return size;
}
export function validateBuckets(buckets: Record<string, BucketConfig> = {}) {
  for (const [name, config] of Object.entries(buckets)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || ['uploads', 'constructor', 'prototype', '__proto__'].includes(name)) throw storageError('INVALID_BUCKET', `Invalid bucket name: ${name}.`);
    if (!config || typeof config !== 'object') throw storageError('INVALID_BUCKET', `Expected configuration for ${name}.`);
    sizeBytes(config.maxSize);
    if (!['public', 'users', 'owner'].includes(config.access as string) && typeof config.access !== 'function') throw storageError('INVALID_BUCKET', `Invalid access for ${name}.`);
    if (config.accept !== undefined && (!Array.isArray(config.accept) || !config.accept.every(m => typeof m === 'string' && /^[\w.+-]+\/(?:[\w.+-]+|\*)$/.test(m)))) throw storageError('INVALID_BUCKET', 'accept must contain MIME patterns such as image/* .');
  }
}
export function fileInfo(name: string, mime = 'application/octet-stream') {
  if (typeof name !== 'string' || !name || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) throw storageError('INVALID_FILE', 'Provide a filename of 1–255 characters without control characters.');
  mime = mime.split(';')[0]!.trim().toLowerCase();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) throw storageError('INVALID_FILE', 'Provide a valid MIME type.');
  return { name, mime };
}
