import type { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { BedrockError } from "../error";

const PAGES = 1000;
const MAX_WAL = 64 * 1024 * 1024;
const POLL_MS = 250;

export function createCheckpoints(sqlite: Database, path: string) {
  const page = (sqlite.query("PRAGMA page_size").get() as { page_size: number }).page_size;
  const threshold = 32 + PAGES * (page + 24);
  let stopped = false;
  let failed = false;
  let checking: Promise<void> | undefined;
  let size = 0;
  let lastAttempt = 0;
  let lastModified = -1;
  let lastSize = -1;
  let active: ReturnType<typeof start> | undefined;

  function fallback(error: unknown) {
    if (failed || stopped) return;
    failed = true;
    sqlite.exec(`PRAGMA wal_autocheckpoint=${PAGES}`);
    console.warn(new BedrockError("DATABASE_CHECKPOINT_FAILED", `Background checkpoint failed for ${path}: ${error}`,
      "SQLite auto-checkpoint is restored; commits may pause. Check disk space, database permissions and Bun Worker support, then restart the pebble.").toJSON());
  }

  function start(final = false) {
    let worker: Worker;
    let ready!: () => void;
    let finish!: () => void;
    const opened = new Promise<void>(resolve => { ready = resolve; });
    const done = new Promise<void>(resolve => { finish = resolve; });
    let completed = false;
    const settle = () => { clearTimeout(watchdog); ready(); finish(); };
    let watchdog: ReturnType<typeof setTimeout>;
    try {
      worker = new Worker(new URL("./checkpoint-worker.ts", import.meta.url).href, { smol: true, ref: false });
      worker.onmessage = ({ data }) => {
        if (data === "ready") ready();
        else if (data === "done") completed = true;
        else fallback(data.error);
      };
      worker.onerror = event => { event.preventDefault(); fallback(event.message); worker.terminate(); };
      worker.addEventListener("close", () => {
        if (!completed) fallback("Worker exited before completing the checkpoint");
        settle();
      });
      watchdog = setTimeout(() => { fallback("Worker did not finish within 30 seconds"); worker.terminate(); }, 30_000);
      watchdog.unref();
      worker.postMessage({ path, final, truncate: size >= MAX_WAL });
      return { opened, done, finish: () => worker.postMessage("finish"), cancel: () => worker.terminate(), completed: () => completed };
    } catch (error) {
      fallback(error);
      ready(); finish();
      return { opened, done, finish() {}, cancel() {}, completed: () => false };
    }
  }

  async function inspect(force = false) {
    try {
      const info = await stat(`${path}-wal`).catch(error => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      size = info?.size ?? 0;
      if (!force && size < MAX_WAL && info?.mtimeMs === lastModified && size === lastSize) return;
      if (stopped || failed || active || size < threshold || (!force && Date.now() - lastAttempt < 1000)) return;
      lastAttempt = Date.now();
      lastModified = info?.mtimeMs ?? -1;
      lastSize = size;
      const run = active = start();
      await run.done;
      if (active === run) active = undefined;
    } catch (error) { fallback(error); }
  }

  const timer = setInterval(() => {
    if (!checking) checking = inspect().finally(() => { checking = undefined; });
  }, POLL_MS);
  timer.unref();

  return {
    check: () => inspect(true),
    // The sampled limit deliberately allows one transaction and one polling interval of overshoot.
    beforeWrite() {
      if (size >= MAX_WAL) throw new BedrockError("DATABASE_WAL_BUSY", `The WAL for ${path} has reached ${Math.round(size / 1024 / 1024)} MiB; writes are paused.`,
        "Finish long-lived read transactions (including backups), allow the background checkpoint to run, then retry. Keep writes in short queue slots.");
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      active?.cancel();
    },
    async close(closeWriter: () => void, deadline: number) {
      stopped = true;
      clearInterval(timer);
      const untilDeadline = async (work: Promise<void>) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([work, new Promise<void>(resolve => { timeout = setTimeout(resolve, Math.max(0, deadline - Date.now())); })]);
        clearTimeout(timeout);
      };
      const pending = active;
      if (pending) {
        await untilDeadline(pending.done);
        if (!pending.completed()) pending.cancel();
      }
      // Holding a second connection moves SQLite's last-close checkpoint off the main thread too.
      const final = active = start(true);
      await untilDeadline(final.opened);
      closeWriter();
      final.finish();
      await untilDeadline(final.done);
      if (!final.completed()) {
        console.warn(new BedrockError("DATABASE_CHECKPOINT_STOPPED", `Final checkpoint for ${path} did not finish before shutdown.`,
          "The WAL is recoverable on restart. Keep db.sqlite and its -wal together when moving data; investigate slow storage or held readers.").toJSON());
        final.cancel();
      }
    },
  };
}
