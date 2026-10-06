import { definePebble, query, mutation, sqliteTable, text, integer, eq, desc } from "bedrock";
import * as v from "valibot";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export default definePebble({
  name: "notes",
  access: "users",
  schema: { notes },
  sync: true,
  queries: {
    mine: query(({ db, user }) =>
      db.select().from(notes).where(eq(notes.ownerId, user!.id)).orderBy(desc(notes.createdAt))),
  },
  mutations: {
    add: mutation(v.object({ body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(10000)) }), ({ db, user }, { body }) =>
      db.insert(notes).values({ ownerId: user!.id, body }).returning()),
  },
  web: "./web/index.html",
  routes: { "GET /api/health": () => new Response("ok") },
  plugins: [],
});
