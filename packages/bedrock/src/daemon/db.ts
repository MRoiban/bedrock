import { validateTokenScope, type TokenScope } from "./token-scope";
import type { User } from "../config";
import { BedrockError } from "../error";
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { privateFile } from "../private-file";
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
      db, home,
      list: () => db.query("SELECT * FROM pebbles ORDER BY name").all() as PebbleRecord[],
      get: (name: string) => db.query("SELECT * FROM pebbles WHERE name=?").get(name) as PebbleRecord | null,
      save(record: PebbleRecord) {
        db.query("INSERT INTO pebbles VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET release=excluded.release, previous_release=excluded.previous_release, status=excluded.status")
          .run(record.name, record.release, record.previous_release, record.status);
      },
      status: (name: string, status: string) => db.query("UPDATE pebbles SET status=? WHERE name=?").run(status, name),
      remove: (name: string) => db.query("DELETE FROM pebbles WHERE name=?").run(name),
      accepts: (token: string) => !!db.query("SELECT hash FROM deploy_tokens WHERE hash=?").get(tokenHash(token)),
      tokens: () => (db.query("SELECT hash AS id, created_at AS createdAt, name, scope, user_id AS userId FROM deploy_tokens ORDER BY created_at").all() as { scope: string | null }[]).map(row => ({ ...row, scope: row.scope ? JSON.parse(row.scope) as TokenScope : null })),
      tokenScope: (token: string) => {
        const row = db.query("SELECT scope FROM deploy_tokens WHERE hash=?").get(tokenHash(token)) as { scope: string | null } | null;
        return row?.scope ? JSON.parse(row.scope) as TokenScope : null;
      },
      tokenOwner: (token: string) => db.query("SELECT u.id, u.email, u.name, COALESCE(u.avatar_url, '') AS avatarUrl FROM deploy_tokens t JOIN users u ON u.id=t.user_id WHERE t.hash=?").get(tokenHash(token)) as User | null,
      revokeToken: (id: string) => db.query("DELETE FROM deploy_tokens WHERE hash=?").run(id).changes > 0,
      tokenEmail: (token: string) => (db.query("SELECT email FROM deploy_tokens WHERE hash=?").get(tokenHash(token)) as { email: string | null } | null)?.email,
      createToken(email?: string, options: { name?: string; scope?: unknown; userId?: string } = {}) {
        const scope = validateTokenScope(options.scope);
        if (options.name !== undefined && (typeof options.name !== "string" || !options.name.trim())) throw new BedrockError("INVALID_ARGS", "Invalid token name.", "Supply a nonempty token name.");
        const owner = options.userId ?? (email ? (db.query("SELECT id FROM users WHERE email=?").get(email) as { id: string } | null)?.id : undefined);
        const token = `br_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
        db.query("INSERT INTO deploy_tokens (hash, created_at, email, name, scope, user_id) VALUES (?, ?, ?, ?, ?, ?)").run(tokenHash(token), Date.now(), email ?? null, options.name ?? null, scope ? JSON.stringify(scope) : null, owner ?? null);
        return token;
      },
      close: () => db.close(true),
    };
  } catch (error) {
    db.close(true);
    throw asBedrockError(error, "DAEMON_DATABASE_FAILED", "Check the daemon database permissions and migrations.");
  }
}
export type DaemonDatabase = Awaited<ReturnType<typeof openDaemonDatabase>>;

export async function localToken(home: string, db: DaemonDatabase) {
  const path = join(home, "admin-token");
  const existing = await Bun.file(path).text().catch(() => "");
  if (existing.trim() && db.accepts(existing.trim())) { await privateFile(path); return existing.trim(); }
  const token = db.createToken();
  await atomicWrite(path, token + "\n");
  return token;
}
