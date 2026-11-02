import { closeSync, constants, openSync, writeSync } from "node:fs";

declare const self: Worker;
self.onmessage = ({ data }: MessageEvent<{ path: string; bytes: number }>) => {
  let fd: number | undefined;
  try {
    // Reclaim blocks the writer for seconds. O_WRONLY also avoids recreating a
    // removed cgroup's control file, and swappiness=200 preserves file caches.
    fd = openSync(data.path, constants.O_WRONLY);
    writeSync(fd, `${data.bytes} swappiness=200`);
    self.postMessage(null);
  } catch (error) {
    self.postMessage((error as NodeJS.ErrnoException).code === "EAGAIN" ? null : String(error));
  } finally { if (fd !== undefined) closeSync(fd); }
};
