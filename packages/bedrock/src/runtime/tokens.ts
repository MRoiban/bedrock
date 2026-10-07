import { and, eq, isNull, asc } from "drizzle-orm";
import { pebbleTokens } from "./token-schema";
import type { Database } from "bun:sqlite";
import type { PebbleConfig, TokenIdentity, TokenMetadata, User, TokenApi, FunctionContext } from "../config";
import { BedrockError } from "../error";
import { resolveUser } from "./identity";
import { checkAccess } from "./access";

interface Row { id: string; user_id: string; user_json: string; name: string; permissions: string; created_at: number; last_used_at: number | null; expires_at: number | null; revoked_at: number | null }
export interface RequestIdentity { user: User | null; token: TokenIdentity | null; validated?: boolean }
const hash = (raw: string) => new Bun.CryptoHasher("sha256").update(raw).digest("hex");
const unauthenticated = () => new BedrockError("UNAUTHENTICATED", "The pebble token is unknown, expired, or revoked.", "Sign in and create a new token.");
export function requirePermission(token: TokenIdentity | null, permission: string) {
  if (token && !token.permissions.includes("*") && !token.permissions.includes(permission))
    throw new BedrockError("FORBIDDEN", "The token does not grant this operation.", `Create a token granting ${permission}.`);
}
export function storagePermission(request: Request) {
  const [bucket, id] = new URL(request.url).pathname.slice("/_bedrock/files/".length).split("/");
  const action = id === "uploads" || request.method === "POST" || request.method === "PUT" ? "upload" : request.method === "DELETE" ? "delete" : "read";
  return `files:${bucket}:${action}`;
}
export function createTokens(pebble: PebbleConfig, sqlite: Database, db: FunctionContext["db"]) {
  const pending = new Map<string, number>();
  const flushed = new Map<string, number>();
  function validate(permission: string) {
    if (permission === "*") return;
    const [kind, name] = permission.split(":");
    if ((kind === "query" || kind === "mutation") && permission === `${kind}:${name}` && Object.hasOwn((kind === "query" ? pebble.queries : pebble.mutations) ?? {}, name!)) return;
    if (permission.startsWith("route:") && Object.hasOwn(pebble.routes ?? {}, permission.slice(6))) return;
    if (permission.startsWith("socket:") && Object.hasOwn(pebble.sockets ?? {}, permission.slice(7))) return;
    const file = /^files:([^:]+):(upload|read|delete)$/.exec(permission);
    if (file && pebble.storage?.some(bucket => bucket.name === file[1])) return;
    throw new BedrockError("INVALID_TOKEN_PERMISSION", `Unknown token permission: ${permission}`, "Use *, query:<registered name>, mutation:<registered name>, route:<registered METHOD /path>, socket:<registered /path>, or files:<registered bucket>:upload|read|delete.");
  }
  function identify(request: Request): RequestIdentity {
    const authorization = request.headers.get("authorization");
    let user: User | null;
    try { user = resolveUser(request); }
    catch (error) {
      if (!pebble.tokens || !authorization?.startsWith("Bearer brk_") || !(error instanceof BedrockError) || error.code !== "INVALID_IDENTITY") throw error;
      user = null;
    }
    if (user) return { user, token: null };
    if (!pebble.tokens || !authorization?.startsWith("Bearer brk_")) {
      // The daemon forwards cookie-free brk_ requests without access gating even
      // when tokens are disabled; ignoring a bearer must not expose private routes.
      if (authorization?.startsWith("Bearer brk_")) checkAccess(pebble, null);
      return { user: null, token: null };
    }
    const row = sqlite.query<Row, [string]>("SELECT * FROM _bedrock_tokens WHERE hash = ?").get(hash(authorization.slice(7)));
    const now = Date.now();
    if (!row || row.revoked_at !== null || row.expires_at !== null && row.expires_at <= now) throw unauthenticated();
    const identity = { user: JSON.parse(row.user_json) as User, token: { id: row.id, name: row.name, permissions: JSON.parse(row.permissions) as string[] } };
    checkAccess(pebble, identity.user);
    if (now - (flushed.get(row.id) ?? row.last_used_at ?? 0) >= 60_000) pending.set(row.id, now);
    return identity;
  }
  const metadata = (row: typeof pebbleTokens.$inferSelect): TokenMetadata => ({ id: row.id, name: row.name, permissions: JSON.parse(row.permissions), createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, expiresAt: row.expiresAt });
  function api(identity: RequestIdentity, writable: boolean): TokenApi {
    function guard(write = false) {
      if (!pebble.tokens) throw new BedrockError("TOKENS_DISABLED", "Pebble tokens are disabled.", "Set tokens: true in definePebble.");
      if (write && !writable) throw new BedrockError("READ_ONLY", "Tokens can only be changed in a mutation.", "Use a mutation or ctx.write callback.");
      if (!identity.user) throw new BedrockError("UNAUTHENTICATED", "Token management requires a user.", "Sign in before managing tokens.");
      return identity.user;
    }
    return {
      create(input) {
        const user = guard(true);
        if (identity.token) throw new BedrockError("FORBIDDEN", "Tokens cannot mint tokens.", "Sign in with a browser session to create a token.");
        if (!input || typeof input.name !== "string" || !input.name.trim() || !Array.isArray(input.permissions) || input.permissions.some(value => typeof value !== "string") || input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now()))
          throw new BedrockError("INVALID_ARGS", "Invalid token name, permissions, or expiry.", "Supply a nonempty name, an array of permission strings, and an optional future Unix timestamp in milliseconds.");
        input.permissions.forEach(validate);
        const token = `brk_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
        const value = { id: crypto.randomUUID(), token, name: input.name, permissions: [...new Set(input.permissions)], createdAt: Date.now(), expiresAt: input.expiresAt ?? null };
        db.insert(pebbleTokens).values({ id: value.id, hash: hash(token), userId: user.id,
          userJson: JSON.stringify(user), name: value.name, permissions: JSON.stringify(value.permissions),
          createdAt: value.createdAt, expiresAt: value.expiresAt }).run();
        return value;
      },
      list() { const user = guard(); return db.select().from(pebbleTokens).where(and(eq(pebbleTokens.userId, user.id), isNull(pebbleTokens.revokedAt))).orderBy(asc(pebbleTokens.createdAt), asc(pebbleTokens.id)).all().map(metadata); },
      revoke(id) {
        const user = guard(true);
        const row = db.select().from(pebbleTokens).where(eq(pebbleTokens.id, id)).get();
        if (!row || row.userId !== user.id) throw new BedrockError("FORBIDDEN", "You can only revoke your own tokens.", "Choose a token id returned by ctx.tokens.list().");
        db.update(pebbleTokens).set({ revokedAt: row.revokedAt ?? Date.now() }).where(eq(pebbleTokens.id, id)).run();
      },
    };
  }
  // Called only inside an executor mutation slot: outside writes would join an
  // unrelated handler's transaction on this shared SQLite connection.
  function flush() {
    const entries = [...pending];
    for (const [id, usedAt] of entries) db.update(pebbleTokens).set({ lastUsedAt: usedAt }).where(eq(pebbleTokens.id, id)).run();
    return () => { for (const [id, usedAt] of entries) { flushed.set(id, Date.now()); if (pending.get(id) === usedAt) pending.delete(id); } };
  }
  return { identify, api, flush };
}
