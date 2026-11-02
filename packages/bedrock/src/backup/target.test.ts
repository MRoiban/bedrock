import { expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "../../test/helpers";
import { r2Target } from "./target";

const credentials = { account: "a".repeat(32), bucket: "backup", accessKeyId: "test", secretAccessKey: "test" };

test("R2 uploads file-backed bodies through a bounded multipart writer", async () => {
  const temp = tempDirectory();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let writes = 0;
  let ended = false;
  let flushes = 0;
  let options: Bun.S3Options | undefined;
  const target = r2Target(credentials, {
    async write() { writes++; return 0; },
    file: (() => ({ writer(value: Bun.S3Options) {
      options = value;
      return { async write(chunk: Uint8Array) { chunks.push(chunk.slice()); return chunk.length; }, async flush() { flushes++; return 0; }, async end() { ended = true; return 0; } };
    } })) as unknown as Bun.S3Client["file"],
    exists: async () => false,
    delete: async () => {},
  });
  try {
    const bytes = new Uint8Array(6 * 1024 * 1024).fill(42);
    const path = join(temp.dir, "body");
    await Bun.write(path, bytes);
    await target.put("object", Bun.file(path));
    expect(writes).toBe(0);
    expect(options).toMatchObject({ partSize: 5 * 1024 * 1024, queueSize: 1 });
    expect(ended).toBe(true);
    expect(flushes).toBeGreaterThan(0);
    expect(new Uint8Array(await new Blob(chunks).arrayBuffer())).toEqual(bytes);
    await target.put("manifest", new TextEncoder().encode("{}"));
    expect(writes).toBe(1);
  } finally { temp.cleanup(); }
});

test("R2 aborts the multipart writer if a file-backed upload fails", async () => {
  const temp = tempDirectory();
  const failure = new Error("upload failed");
  let aborted: Error | undefined;
  const target = r2Target(credentials, {
    write: async () => 0,
    file: (() => ({ writer() {
      return { async write() { throw failure; }, async end(error?: Error) { aborted = error; return 0; } };
    } })) as unknown as Bun.S3Client["file"],
    exists: async () => false,
    delete: async () => {},
  });
  try {
    const path = join(temp.dir, "body");
    await Bun.write(path, "body");
    await expect(target.put("object", Bun.file(path))).rejects.toBe(failure);
    expect(aborted).toBe(failure);
  } finally { temp.cleanup(); }
});
