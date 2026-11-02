import type { Database } from "bun:sqlite";
import { BedrockError } from "../error";

// SQLite's WAL-reset fix was also backported to these two release branches.
export function hasWalResetBug(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return true;
  const [major, minor, patch] = version.split(".").map(Number) as [number, number, number];
  if (major !== 3) return false;
  if (minor < 7 || minor > 51) return false;
  if (minor === 44 && patch >= 6 || minor === 50 && patch >= 7) return false;
  return minor < 51 || patch < 3;
}

export function assertConcurrentWalSafe(sqlite: Database) {
  const { version } = sqlite.query<{ version: string }, []>("SELECT sqlite_version() AS version").get()!;
  if (hasWalResetBug(version)) throw new BedrockError("DATABASE_UNSAFE_SQLITE",
    `SQLite ${version} has the WAL-reset corruption bug; overlapping pebble writers are unsafe.`,
    "Upgrade Bun / use a Bun build with SQLite 3.51.3+ (or patched 3.44.6 / 3.50.7). Stop the pebble before replacing its running release.");
}
