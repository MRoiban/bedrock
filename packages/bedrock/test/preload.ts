import { afterAll } from "bun:test";
import { cleanupWindowsTestServices } from "./service-cleanup";

// Sweep even after failed/timed-out tests, and retain an exit fallback for early exits.
if (process.platform === "win32") {
  afterAll(() => cleanupWindowsTestServices(), 30000);
  process.on("exit", () => cleanupWindowsTestServices());
}
