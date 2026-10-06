import { definePebble, bucket, query, mutation, sqliteTable, text, integer, eq, desc } from "bedrock";
import * as v from "valibot";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id").notNull(),
  attachmentId: text("attachment_id"),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

const storage = { attachments: bucket({ maxSize: "50mb", access: "owner" }) };

export default definePebble({
  name: "notes",
  access: "users",
  schema: { notes },
  sync: true,
  storage,
  queries: {
    mine: query(({ db, user }) =>
      db.select().from(notes).where(eq(notes.ownerId, user!.id)).orderBy(desc(notes.createdAt))),
  },
  mutations: {
    add: mutation(storage, v.object({ attachmentId: v.optional(v.string()), body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(10000)) }), async ({ db, user, storage }, { body, attachmentId }) => {
      if (attachmentId) await storage.attachments.get(attachmentId);
      return db.insert(notes).values({ ownerId: user!.id, body, attachmentId: attachmentId ?? null }).returning();
    }),
  },
  web: "./web/index.html",
  routes: { "GET /api/health": () => new Response("ok") },
  plugins: [],
});
