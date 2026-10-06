# Building a pebble with Bedrock

Requires Bun ≥ 1.2. Install bedrock; run everything with Bun (the package ships TypeScript).
pebble.ts default-exports definePebble and is the source of truth.

```ts
import { definePebble, query, mutation, sqliteTable, text } from "bedrock";

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  body: text("body").notNull(),
});
export default definePebble({
  name: "hello",
  access: "public",
  schema: { messages },
  queries: { list: query(({ db }) => db.select().from(messages)) },
  mutations: {
    add: mutation(({ db }) =>
      db.insert(messages).values({ id: crypto.randomUUID(), body: "Hello" }).returning()),
  },
  web: "./web/index.html",
});
```

- query(fn), query(standardSchema, fn), mutation(fn), mutation(standardSchema, fn).
- Handlers receive { db, user, pebble, storage, request }. user is null anonymously.
- Queries are read-only. Mutations commit atomically or roll back on error.
- Use a Standard Schema for any mutation accepting user arguments.
- Drizzle operators and SQLite builders are re-exported from bedrock.
- BedrockError has code, message, hint, and toJSON().
- HTTP: POST /_bedrock/q/<name> or /_bedrock/m/<name>, JSON arguments (null without args).
  Responses: { ok: true, value } or { ok: false, error: { code, message, hint } }.
- Development: bedrock dev [--port 3000]. Data lives in ./.bedrock/db.sqlite.
  The CLI enables BEDROCK_INSECURE_DEV_USER=1 in its localhost worker only.
  Send x-bedrock-user containing JSON { id, email? } to test user access.
- Migration generation: bun add --dev drizzle-kit; bedrock db generate.
  Tables in pebble.schema are used automatically. Commit migrations/ including meta/.
  bedrock db plan shows pending SQL; bedrock db migrate applies it to ./.bedrock/.
  Never edit an applied migration; add a new one. Bedrock owns transaction boundaries.
- Every CLI command supports --json; dev emits one startup object, restart logs go to stderr.
- startPebble({ dir, dataDir, port: 0 }) from bedrock/server returns
  { server, pebble, db, execute, stop }. execute(kind, name, args, request) returns
  { value, reads: Set<string>, writes: Set<string> } for future sync support.
- Without dataDir, startPebble uses $BEDROCK_HOME/pebbles/<name>/data
  (BEDROCK_HOME defaults to ~/.bedrock). Tests must always use temporary data.
- routes: { "GET /api/health": () => new Response("ok") } uses Bun route matching.
  /_bedrock/ is reserved. HTML web entries are bundled by Bun; directories serve static files.
- Phase 1 only: storage and plugins are config helpers, with no implementation.
  No signed identity, login redirects, daemon, sync, client SDK, or OAuth yet.
  Function APIs enforce users/email allow lists; web and escape-hatch routes are public.
  Creator access requires the future daemon.

Table tracking matches known schema table identifiers in executed Drizzle SQL and
conservatively over-records reads. It does not observe direct db.$client calls,
implicit trigger writes, or foreign-key cascades; these need handling before sync.
