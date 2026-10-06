import { listR2, type R2Credentials, type ListPage } from "./r2-list";
import { mkdir, readdir, rm, rename } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { BedrockError, asBedrockError } from "../error";

export interface BackupTarget {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export function fsTarget(directory: string): BackupTarget {
  const root = resolve(directory);
  function path(key: string) {
    const target = resolve(root, key);
    if (!target.startsWith(root + sep)) throw new BedrockError("INVALID_BACKUP_KEY", "Unsafe backup object key.", "Use a key relative to the backup directory.");
    return target;
  }
  return {
    async put(key, bytes) {
      const file = path(key);
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      await mkdir(dirname(file), { recursive: true });
      try { await Bun.write(temporary, bytes); await rename(temporary, file); }
      finally { await rm(temporary, { force: true }); }
    },
    async get(key) { try { return new Uint8Array(await Bun.file(path(key)).arrayBuffer()); } catch (error) { throw asBedrockError(error, "BACKUP_READ_FAILED", "Check the backup directory and object key."); } },
    exists: key => Bun.file(path(key)).exists(),
    async delete(key) { await rm(path(key), { force: true }); },
    async list(prefix) {
      const result: string[] = [];
      async function walk(dir: string, key: string) {
        const entries = await readdir(dir, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; });
        for (const entry of entries) {
          const child = key + entry.name;
          if (entry.isDirectory()) await walk(join(dir, entry.name), child + "/");
          else if (entry.isFile() && child.startsWith(prefix)) result.push(child);
        }
      }
      const directoryKey = prefix.slice(0, prefix.lastIndexOf("/") + 1);
      await walk(directoryKey ? path(directoryKey) : root, directoryKey);
      return result.sort();
    },
  };
}

type S3Operations = Pick<Bun.S3Client, "write" | "file" | "exists" | "delete"> & {
  list?: (options: Bun.S3ListObjectsOptions) => Promise<ListPage>;
};

export function r2Target(config: R2Credentials, suppliedClient?: S3Operations): BackupTarget {
  const client = suppliedClient ?? new Bun.S3Client({
    endpoint: `https://${config.account}.r2.cloudflarestorage.com`, bucket: config.bucket,
    accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey,
  });
  return {
    async put(key, bytes) { await client.write(key, bytes); },
    async get(key) { return new Uint8Array(await client.file(key).arrayBuffer()); },
    exists: key => client.exists(key),
    async delete(key) { await client.delete(key); },
    async list(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const page = client.list
          ? await client.list({ prefix, ...(continuationToken ? { continuationToken } : {}) })
          : await listR2(config, prefix, continuationToken);
        for (const object of page.contents ?? []) keys.push(object.key);
        if (page.isTruncated && (!page.nextContinuationToken || page.nextContinuationToken === continuationToken)) throw new BedrockError("BACKUP_R2_FAILED", "R2 listing did not advance its continuation token.", "Retry the backup; inspect the bucket listing response.");
        continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
      } while (continuationToken);
      return keys.sort();
    },
  };
}
