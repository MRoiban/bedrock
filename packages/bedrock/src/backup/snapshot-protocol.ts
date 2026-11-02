import type { DirectoryBackup } from "../config/hosting";
import { BedrockError, asBedrockError, errorStatus } from "../error";
import type { Manifest } from "./snapshot";

export interface SnapshotInput {
  name: string;
  databasePath: string;
  filesDir?: string | undefined;
  now: Date;
  directories?: DirectoryBackup | undefined;
}
export type SnapshotError = ReturnType<BedrockError["toJSON"]> & { status: number };
export type TargetRequest = { id: number; key: string } & (
  { method: "exists" } | { method: "put"; body: Uint8Array | { path: string } }
);
export type WorkerMessage = TargetRequest | { manifest: Manifest } | { error: SnapshotError };
export type TargetReply = { id: number } & ({ value: boolean | void } | { error: SnapshotError });

export function snapshotError(error: unknown): SnapshotError {
  const typed = asBedrockError(error, "BACKUP_FAILED", "Check the backup target, credentials, disk space, and daemon logs.");
  return { ...typed.toJSON(), status: errorStatus(typed) };
}
export const fromSnapshotError = (error: SnapshotError) => new BedrockError(error.code, error.message, error.hint, error.detail, { status: error.status, data: error.data });
