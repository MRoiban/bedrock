import { plugin, sqliteTable, text, integer } from "../../packages/bedrock/src";

export const auditEntries = sqliteTable("audit_entries", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  userId: text("user_id"),
  createdAt: integer("created_at").notNull(),
});

export const auditLog = plugin({
  name: "audit-log",
  schema: { auditEntries },
  async onMutation(ctx, name, _args, next) {
    const result = await next();
    ctx.db.insert(auditEntries).values({ id: crypto.randomUUID(), action: name, userId: ctx.user?.id ?? null, createdAt: Date.now() }).run();
    return result;
  },
});
