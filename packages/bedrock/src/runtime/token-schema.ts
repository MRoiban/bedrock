import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const pebbleTokens = sqliteTable("_bedrock_tokens", {
  id: text("id").primaryKey(), hash: text("hash").notNull().unique(),
  userId: text("user_id").notNull(), userJson: text("user_json").notNull(),
  name: text("name").notNull(), permissions: text("permissions").notNull(),
  createdAt: integer("created_at").notNull(), lastUsedAt: integer("last_used_at"),
  expiresAt: integer("expires_at"), revokedAt: integer("revoked_at"),
});
export const tokenMigration = `CREATE TABLE IF NOT EXISTS _bedrock_tokens (
 id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, user_json TEXT NOT NULL,
 name TEXT NOT NULL, permissions TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER,
 expires_at INTEGER, revoked_at INTEGER);`;
