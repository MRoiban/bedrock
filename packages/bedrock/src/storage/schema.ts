import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const files = sqliteTable('_bedrock_files', {
  id: text('id').primaryKey(), bucket: text('bucket').notNull(), ownerId: text('owner_id'),
  name: text('name').notNull(), mime: text('mime').notNull(), size: integer('size').notNull(),
  sha256: text('sha256').notNull(), createdAt: integer('created_at').notNull(),
});
export const storageMigration = `CREATE TABLE IF NOT EXISTS _bedrock_files (
 id TEXT PRIMARY KEY, bucket TEXT NOT NULL, owner_id TEXT, name TEXT NOT NULL,
 mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS _bedrock_files_bucket ON _bedrock_files(bucket, id);`;
