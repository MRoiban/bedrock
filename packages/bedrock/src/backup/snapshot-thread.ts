import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { BedrockError } from "../error";
import type { BackupTarget } from "./target";
import type { Manifest } from "./snapshot";
import { fromSnapshotError, snapshotError, type SnapshotInput, type WorkerMessage } from "./snapshot-protocol";

export async function snapshotInWorker(target: BackupTarget, input: SnapshotInput, signal?: AbortSignal): Promise<Manifest> {
  const cancelled = () => new BedrockError("BACKUP_CANCELLED", "Backup cancelled during daemon shutdown.", "Restart the daemon and retry the backup.");
  if (signal?.aborted) throw cancelled();
  // Beside the database: the OS temp directory may be too small for a copy.
  const temp = await mkdtemp(join(dirname(input.databasePath), ".bedrock-backup-"));
  let worker: Worker | undefined;
  let abort: (() => void) | undefined;
  try {
    if (signal?.aborted) throw cancelled();
    worker = new Worker(new URL("./snapshot-worker.ts", import.meta.url), {
      workerData: { ...input, databasePath: resolve(input.databasePath), filesDir: input.filesDir && resolve(input.filesDir), temp: resolve(temp) },
    });
    const thread = worker;
    return await new Promise<Manifest>((resolve, reject) => {
      let finished = false;
      const fail = (error: unknown) => { finished = true; reject(error); };
      abort = () => fail(cancelled());
      signal?.addEventListener("abort", abort, { once: true });
      thread.on("error", error => fail(fromSnapshotError(snapshotError(error))));
      thread.on("exit", code => {
        if (!finished) fail(new BedrockError("BACKUP_FAILED", `Backup worker exited without a result (code ${code}).`, "Retry the backup; inspect daemon logs and available memory."));
      });
      thread.on("message", async (message: WorkerMessage) => {
        if (finished) return;
        if ("manifest" in message) { finished = true; resolve(message.manifest); return; }
        if ("error" in message) { fail(fromSnapshotError(message.error)); return; }
        try {
          const value = message.method === "exists" ? await target.exists(message.key)
            : await target.put(message.key, message.body instanceof Uint8Array ? message.body : Bun.file(message.body.path));
          if (!finished) thread.postMessage({ id: message.id, value });
        } catch (error) {
          if (!finished) thread.postMessage({ id: message.id, error: snapshotError(error) });
        }
      });
    });
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    // Wait for SQLite and stream handles to close before removing files (also on Windows).
    try { await worker?.terminate(); }
    finally { await rm(temp, { recursive: true, force: true }); }
  }
}
