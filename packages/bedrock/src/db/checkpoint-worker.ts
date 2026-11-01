import { Database } from "bun:sqlite";

declare const self: Worker;
let sqlite: Database | undefined;

self.onmessage = ({ data }: MessageEvent<{ path: string; final?: boolean; truncate?: boolean } | "finish">) => {
  try {
    if (data !== "finish") {
      // Never recreate a database after its owner has stopped or moved it.
      sqlite = new Database(data.path, { readwrite: true, strict: true });
      sqlite.exec("PRAGMA busy_timeout=0; PRAGMA synchronous=NORMAL; PRAGMA wal_autocheckpoint=0");
      if (data.final) { self.postMessage("ready"); return; }
    }
    if (data === "finish" || data.truncate) {
      sqlite!.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } else {
      // NOOP counts pending frames without syncing on SQLite versions that support it.
      // Older SQLite treats an unknown mode as PASSIVE, still entirely off the main thread.
      const pending = sqlite!.query<{ busy: number; log: number; checkpointed: number }, []>("PRAGMA wal_checkpoint(NOOP)").get()!;
      if (pending.log - pending.checkpointed >= 1000) {
        // A slow sync can let the writer append again; a few passes give WAL reuse a chance without locking it.
        for (let attempt = 0; attempt < 3; attempt++) {
          sqlite!.exec("PRAGMA wal_checkpoint(PASSIVE)");
          const remaining = sqlite!.query<{ log: number; checkpointed: number }, []>("PRAGMA wal_checkpoint(NOOP)").get()!;
          if (remaining.log === remaining.checkpointed) break;
        }
      }
    }
    sqlite!.close(true);
    sqlite = undefined;
    self.postMessage("done");
  } catch (error) {
    sqlite?.close(true);
    sqlite = undefined;
    self.postMessage({ error: String(error) });
  }
  process.exit(0);
};
