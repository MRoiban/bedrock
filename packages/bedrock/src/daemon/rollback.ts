import { Database } from "bun:sqlite";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BedrockError } from "../error";

export async function assertRollbackSafe(path: string, release: string) {
  const database = new Database(path, { readonly: true });
  try {
    const exists = database.query("SELECT name FROM sqlite_master WHERE name='_bedrock_migrations'").get();
    const applied = exists ? database.query("SELECT name FROM _bedrock_migrations").all() as { name: string }[] : [];
    const migrations = new Set(await readdir(join(release, "migrations")).catch(error => { if (error.code === "ENOENT") return []; throw error; }));
    if (applied.some(row => !migrations.has(row.name))) throw new BedrockError("ROLLBACK_MIGRATIONS", "The target release lacks migrations already applied to this database.", "Use bedrock backup restore <pebble> --at <timestamp> --yes, or rollback --force only if the old code supports the current schema.");
  } finally { database.close(); }
}
