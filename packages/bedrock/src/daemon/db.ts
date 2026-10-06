import { Database } from "bun:sqlite";
import { mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { applyMigrations } from "../db";
import { asBedrockError } from "../error";
import { atomicWrite } from "./config";

export interface PebbleRecord { name: string; release: string; previous_release: string | null; status: string }
export const tokenHash = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");

export async function openDaemonDatabase(home: string, migrations = join(import.meta.dir, "migrations")) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const db = new Database(join(home, "bedrock.sqlite"), { create: true, strict: true });
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    await applyMigrations(db, migrations);
    return {
      db,
      list: () => db.query("SELECT * FROM pebbles ORDER BY name").all() as PebbleRecord[],
      get: (name: string) => db.query("SELECT * FROM pebbles WHERE name=?").get(name) as PebbleRecord | null,
      save(record: PebbleRecord) {
        db.query("INSERT INTO pebbles VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET release=excluded.release, previous_release=excluded.previous_release, status=excluded.status")
          .run(record.name, record.release, record.previous_release, record.status);
      },
      status: (name: string, status: string) => db.query("UPDATE pebbles SET status=? WHERE name=?").run(status, name),
      remove: (name: string) => db.query("DELETE FROM pebbles WHERE name=?").run(name),
      accepts: (token: string) => !!db.query("SELECT hash FROM deploy_tokens WHERE hash=?").get(tokenHash(token)),
      tokens: () => db.query("SELECT hash AS id, created_at AS createdAt FROM deploy_tokens ORDER BY created_at").all(),
      revokeToken: (id: string) => db.query("DELETE FROM deploy_tokens WHERE hash=?").run(id).changes > 0,
      createToken() {
        const token = `br_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
        db.query("INSERT INTO deploy_tokens VALUES (?, ?)").run(tokenHash(token), Date.now());
        return token;
      },
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw asBedrockError(error, "DAEMON_DATABASE_FAILED", "Check the daemon database permissions and migrations.");
  }
}
export type DaemonDatabase = Awaited<ReturnType<typeof openDaemonDatabase>>;

export async function localToken(home: string, db: DaemonDatabase) {
  const path = join(home, "admin-token");
  const existing = await Bun.file(path).text().catch(() => "");
  if (existing.trim() && db.accepts(existing.trim())) { await chmod(path, 0o600); return existing.trim(); }
  const token = db.createToken();
  await atomicWrite(path, token + "\n");
  return token;
}
