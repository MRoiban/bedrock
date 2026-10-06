import type { Database } from "bun:sqlite";
import type { User } from "../config";
import { tokenHash } from "../daemon/db";

export const DAY = 86_400_000;
export const SESSION_LIFETIME = 30 * DAY;
export const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
export interface Session { hash: string; user: User; expiresAt: number; refreshed: boolean }

export function createSessions(db: Database, now = Date.now) {
  function user(email: string, name: string, avatarUrl?: string): User {
    email = email.trim().toLowerCase();
    db.query(`INSERT INTO users VALUES (?, ?, ?, ?, ?) ON CONFLICT(email)
      DO UPDATE SET name=excluded.name, avatar_url=excluded.avatar_url`).run(crypto.randomUUID(), email, name, avatarUrl ?? null, now());
    const row = db.query("SELECT id, email, name, COALESCE(avatar_url, '') AS avatarUrl FROM users WHERE email=?").get(email) as User;
    return row;
  }
  function create(userId: string) {
    const token = randomToken();
    const time = now();
    db.query("DELETE FROM sessions WHERE expires_at <= ?").run(time);
    db.query("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(tokenHash(token), userId, time + SESSION_LIFETIME, time);
    return token;
  }
  function resolve(token: string | null, slide = true): Session | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const hash = tokenHash(token);
    const row = db.query(`SELECT u.id, u.email, u.name, COALESCE(u.avatar_url, '') AS avatarUrl, s.expires_at
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?`).get(hash) as (User & { expires_at: number }) | null;
    if (!row) return null;
    const time = now();
    if (row.expires_at <= time) { db.query("DELETE FROM sessions WHERE id_hash=?").run(hash); return null; }
    const refreshed = slide && row.expires_at <= time + SESSION_LIFETIME - DAY;
    const expiresAt = refreshed ? time + SESSION_LIFETIME : row.expires_at;
    if (refreshed) db.query("UPDATE sessions SET expires_at=? WHERE id_hash=?").run(expiresAt, hash);
    const { expires_at, ...identity } = row;
    return { hash, user: identity, expiresAt, refreshed };
  }
  return { user, create, resolve, revoke: (hash: string) => db.query("DELETE FROM sessions WHERE id_hash=?").run(hash) };
}
export type Sessions = ReturnType<typeof createSessions>;
