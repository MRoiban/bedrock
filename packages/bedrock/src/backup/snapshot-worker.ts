import { parentPort, workerData } from "node:worker_threads";
import { Database } from "bun:sqlite";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { join, dirname } from "node:path";
import { asBedrockError, BedrockError } from "../error";
import { snapshotDirectories } from "./directories";
import { sha256, type Manifest } from "./snapshot";
import type { BackupTarget } from "./target";
import { fromSnapshotError, snapshotError, type SnapshotInput, type TargetRequest, type TargetReply } from "./snapshot-protocol";
import { version } from "../../package.json";

const port = parentPort!;
let nextId = 0;
const pending = new Map<number, { resolve: (value: boolean | void) => void; reject: (error: unknown) => void }>();
port.on("message", (reply: TargetReply) => {
  const request = pending.get(reply.id);
  pending.delete(reply.id);
  if ("error" in reply) request?.reject(fromSnapshotError(reply.error));
  else request?.resolve(reply.value);
});
function request(message: TargetRequest): Promise<boolean | void> {
  return new Promise((resolve, reject) => {
    pending.set(message.id, { resolve, reject });
    const transfer = message.method === "put" && message.body instanceof Uint8Array ? [message.body.buffer as ArrayBuffer] : [];
    port.postMessage(message, transfer);
  });
}
const target: Pick<BackupTarget, "put" | "exists"> = {
  exists: async key => !!await request({ id: nextId++, method: "exists", key }),
  put: async (key, body) => { await request({ id: nextId++, method: "put", key, body: body instanceof Uint8Array ? body : { path: body.name! } }); },
};
const hasTable = (db: Database, name: string) => !!db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);

async function snapshot(input: SnapshotInput & { temp: string }): Promise<Manifest> {
  const { name, databasePath, filesDir, now, directories, temp } = input;
  const path = join(temp, "snapshot.sqlite");
  const gzipPath = join(temp, "snapshot.sqlite.gz");
  let source: Database | undefined;
  let copy: Database | undefined;
  try {
    source = new Database(databasePath, { readonly: true });
    source.exec("PRAGMA busy_timeout=5000");
    source.query("VACUUM INTO ?").run(path);
    source.close(); source = undefined;
    copy = new Database(path, { readonly: true });
    const hasher = new Bun.CryptoHasher("sha256");
    await pipeline(createReadStream(path, { highWaterMark: 256 * 1024 }), new Transform({
      transform(chunk, _encoding, callback) { hasher.update(chunk); callback(null, chunk); },
    }), createGzip({ chunkSize: 256 * 1024 }), createWriteStream(gzipPath));
    const timestamp = now.toISOString();
    const filename = timestamp.replaceAll(":", "-");
    const base = name === "_daemon" ? "daemon/" : `pebbles/${name}/`;
    const manifest: Manifest = { timestamp, db: `${base}db/${filename}.sqlite.gz`, dbSha256: hasher.digest("hex"), files: {}, version, migrations: hasTable(copy, "_bedrock_migrations") ? copy.query("SELECT name, hash FROM _bedrock_migrations ORDER BY name").all() as Manifest["migrations"] : [] };
    if (filesDir && hasTable(copy, "_bedrock_files")) {
      const files = copy.query("SELECT id, bucket, sha256 FROM _bedrock_files").all() as { id: string; bucket: string; sha256: string }[];
      for (const file of files) {
        const key = `${base}files/${file.sha256}`;
        if (!await target.exists(key)) {
          const body = new Uint8Array(await Bun.file(join(filesDir, file.bucket, file.id)).arrayBuffer());
          if (sha256(body) !== file.sha256) throw new BedrockError("BACKUP_CHECKSUM", `File ${file.id} does not match its metadata.`, "Repair the file before backing up; retry if it was deleted during backup.");
          await target.put(key, body);
        }
        manifest.files[file.id] = file.sha256;
      }
    }
    if (directories) Object.assign(manifest, await snapshotDirectories(target, base, dirname(databasePath), directories));
    await target.put(manifest.db, Bun.file(gzipPath));
    // Publishing last keeps incomplete uploads invisible to restore.
    await target.put(`${base}manifests/${filename}.json`, new TextEncoder().encode(JSON.stringify(manifest)));
    return manifest;
  } catch (error) { throw asBedrockError(error, "BACKUP_FAILED", "Check the backup target and retry.", databasePath); } finally { source?.close(); copy?.close(); }
}

try { port.postMessage({ manifest: await snapshot(workerData) }); }
catch (error) { port.postMessage({ error: snapshotError(error) }); }
finally { port.close(); }
