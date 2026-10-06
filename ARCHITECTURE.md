# Bedrock — Architecture

Bedrock is a personal cloud. One home server hosts many small projects called
**pebbles**, each reachable at `https://<pebble>.<domain>`. Fewer than 10 people
create pebbles; each pebble serves at most ~1,000 users.

Ethos, in priority order: **simple, lightweight, modular, extensible, agent-friendly.**
Every dependency must be small and must not own our data model.

## 1. Stack

| Concern        | Choice                                   |
|----------------|------------------------------------------|
| Runtime        | Bun ≥ 1.2 (`bun:sqlite`, `Bun.serve`, WebSockets) |
| Database       | SQLite (WAL), **one file per pebble**    |
| Schema / SQL   | Drizzle ORM (re-exported, not wrapped)    |
| Migrations     | drizzle-kit generates SQL; bedrock applies it |
| Validation     | Any [Standard Schema](https://standardschema.dev) (zod, valibot, arktype) — no hard dependency |
| Auth           | Google OAuth via `arctic`; sessions in our own SQLite |
| Sync           | Our own reactive queries over WebSocket   |
| Storage        | Local filesystem behind a driver interface |
| Network        | Cloudflare Tunnel (`cloudflared`), the only external host dependency |
| Backups        | Litestream (SQLite) + restic (files) → Cloudflare R2 |

No Postgres, no Redis, no Docker, no reverse proxy.

## 2. Repository layout

Bun workspace monorepo.

```
packages/
  bedrock/            the npm package users install ("bedrock")
    src/
      config/         definePebble, query, mutation, bucket, types
      db/             open SQLite, apply migrations, table tracking
      runtime/        runs ONE pebble: HTTP + WS server, functions, sync, storage
      sync/           subscription registry, invalidation, diff push
      storage/        driver interface + fs driver, upload/download handlers
      auth/           Google OAuth, sessions, access policies (used by daemon)
      daemon/         runs ALL pebbles: host router, process supervisor, deploy API
      tunnel/         Cloudflare API client + cloudflared supervision
      client/         browser SDK (framework-agnostic)
      react/          React hooks over client/
      cli/            the `bedrock` binary
    test/
  ui/                 "@bedrock/ui" — Onyx-based components (later phase, React only)
examples/
  notes/              reference pebble, used by e2e tests
```

Public entry points of `bedrock` (package.json `exports`):

| Import            | Contents |
|-------------------|----------|
| `bedrock`         | `definePebble`, `query`, `mutation`, `bucket`, `plugin`, types; re-exports `drizzle-orm` operators and `drizzle-orm/sqlite-core` table builders |
| `bedrock/client`  | `createClient()` |
| `bedrock/react`   | `BedrockProvider`, `useQuery`, `useMutation`, `useUser`, `useUpload` |
| `bedrock/server`  | `startPebble()` (low-level, used by daemon and tests) |
| bin `bedrock`     | CLI |

Modules talk through exported TypeScript interfaces only. No module reaches into
another's internals. Built-in features use the same plugin hooks third parties get.

## 3. The pebble contract: `pebble.ts`

A pebble is a directory with a `pebble.ts` default-exporting `definePebble(...)`.
This file is the **single source of truth** an agent reads to understand a pebble.

```ts
import { definePebble, query, mutation, bucket, sqliteTable, text, integer, eq, desc } from "bedrock";
import * as v from "valibot";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id").notNull(),
  attachmentId: text("attachment_id"),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const attachments = bucket("attachments", { maxSize: "50mb", access: "owner" });

const attachments = bucket("attachments", { maxSize: "50mb", access: "owner" });

export default definePebble({
  name: "notes",                        // subdomain; [a-z0-9-]{1,32}
  access: "users",                      // see §5
  schema: { notes },
  sync: true,                           // enable live subscriptions

  queries: {
    mine: query(({ db, user }) =>
      db.select().from(notes).where(eq(notes.ownerId, user!.id)).orderBy(desc(notes.createdAt))),
  },

  mutations: {
    add: mutation(v.object({ body: v.string(), attachmentId: v.optional(v.string()) }),
      async ({ db, user, storage }, { body, attachmentId }) => {
        // The owner policy prevents linking another user’s attachment.
        if (attachmentId) await storage.get(attachments, attachmentId);
        return db.insert(notes).values({ ownerId: user!.id, body, attachmentId }).returning();
      }),
  },

  storage: [attachments],

  web: "./web/index.html",              // Bun HTML entry, bundled by Bun; or a static dir
  routes: { "GET /api/health": () => new Response("ok") }, // escape hatch, plain Bun handlers
  plugins: [],
});
```

Rules:
- `query(fn)` / `query(schema, fn)` and `mutation(fn)` / `mutation(schema, fn)`. Args are validated with the Standard Schema if given.
- Function context: `{ db, user, pebble, storage, request }`. `user` is `null` when anonymous.
- Queries are read-only (enforced: run inside a read transaction). Mutations run inside a write transaction.
- Types flow end-to-end: the client infers query/mutation names, args and results from `typeof pebble`.

## 4. Database

- File: `$BEDROCK_HOME/pebbles/<name>/data/db.sqlite`, opened with `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`.
- Migrations live in `<pebble>/migrations/*.sql`, generated by `bedrock db generate` (thin wrapper over drizzle-kit, configured automatically from `pebble.ts` — the user never writes a drizzle config).
- Migrations are applied in order on deploy and on `bedrock dev` start, tracked in `_bedrock_migrations`. A failed migration aborts the deploy and leaves the previous version running.
- `bedrock db plan` prints pending SQL without applying it. `bedrock db shell <pebble>` opens a SQL REPL.
- Tables starting with `_bedrock_` are reserved.

## 5. Auth and access

Identity is **global** (one Google account = one bedrock user across all pebbles);
authorization is **per pebble**.

- The daemon owns `$BEDROCK_HOME/bedrock.sqlite`: `users(id, email, name, avatar_url, created_at)`, `sessions(id_hash, user_id, expires_at)`, `pebbles(...)`, `deploy_tokens(...)`.
- Login flow lives at `https://auth.<domain>` (Google OAuth via arctic, PKCE). Session cookie `bedrock_session` is set on `.<domain>`, HttpOnly, Secure, SameSite=Lax, 30-day sliding expiry. Session ids are stored hashed (SHA-256).
- The daemon resolves the session and forwards the user to the pebble process as `x-bedrock-user` (JSON) plus `x-bedrock-signature` (HMAC with a per-boot secret). Pebble processes reject unsigned identity headers; the daemon strips any incoming `x-bedrock-*` headers from the internet.
- `access` modes:
  - `"public"` — anyone; `user` may be null.
  - `"users"` — any signed-in Google account.
  - `{ allow: ["a@x.com", "@company.com"] }` — emails or whole domains.
  - `"creators"` — only the bedrock creators list (from daemon config).
- Unauthenticated page requests to a protected pebble redirect to `auth.<domain>/login?return=...`; API/WS requests get 401.
- **Dev mode** (`bedrock dev`): no Google. A local login page lets you pick any email. Agents must be able to test auth flows without credentials.

## 6. Sync (reactive queries)

Only when `sync: true`. Writes always go through mutations.

1. Client opens one WebSocket to `/_bedrock/ws` and sends `{ op: "sub", id, query, args }`.
2. The server runs the query and records which tables it read, by capturing every SQL statement executed during the call (Drizzle logger + `AsyncLocalStorage`) and matching identifiers against the known table names.
3. Each mutation records the tables it wrote the same way.
4. After a mutation commits, every subscription whose read-set intersects the write-set is re-run **for its own user** (permissions are just the query's `where` clause). If the result hash changed, the server pushes `{ op: "data", id, result }`.
5. Re-runs are debounced/coalesced per subscription (~16 ms) so bursts of writes cause one push.
6. Clients reconnect with exponential backoff and resubscribe automatically. Mutations over WS return `{ op: "result", id, ok, value | error }`.

Without `sync`, the same queries/mutations are callable over plain HTTP:
`POST /_bedrock/q/<name>` and `POST /_bedrock/m/<name>`.

Future (do not build yet): row-level diffs, optimistic updates.

## 7. Storage

- Files live in `$BEDROCK_HOME/pebbles/<name>/data/files/<bucket>/<id>`; metadata in the pebble DB table `_bedrock_files(id, bucket, owner_id, name, mime, size, sha256, created_at)`.
- `bucket(name, { maxSize, access, accept? })`; register with `storage: [attachments]`, `access`: `"public" | "users" | "owner" | (ctx, file) => boolean`.
- Endpoints: `POST /_bedrock/files/<bucket>` (upload), `GET /_bedrock/files/<bucket>/<id>` (download with Range support), `HEAD` and `DELETE` same path.
- **Chunked uploads** are mandatory for files > 90 MB (Cloudflare's free plan rejects request bodies > 100 MB): `POST .../uploads` → `PUT .../uploads/<uid>/<n>` → `POST .../uploads/<uid>/complete`. The client SDK chunks transparently.
- Server-side API in functions: `storage.put(attachments, blobOrStream, { name, mime? })`, `storage.get(attachments, id)` (Blob), `storage.delete(attachments, id)`, `storage.list(attachments, { ownerId?, limit?, cursor? })` (metadata).
- Bucket names use `[a-z0-9_-]{1,32}`; names must be unique within a pebble. `bucket()` and `definePebble()` validate configuration with repair hints. Passing a bucket object absent from the registered array throws `BedrockError("UNKNOWN_BUCKET", …, hint)`.
- `ctx.storage` is shared across all handlers; bucket objects supply configuration without pebble-specific context inference. Function signatures remain `query(fn) | query(schema, fn)` and `mutation(fn) | mutation(schema, fn)`.
- Client APIs take bucket names inferred from `typeof pebble`: `client.upload("attachments", file)`, `client.fileUrl("attachments", id)`, `client.deleteFile("attachments", id)` and `useUpload<typeof pebble>("attachments")`. Client code does not import server bucket configurations.
- Driver interface `{ put, get, delete, stat }` — `fs` is the only built-in driver; R2 can be added later.

## 8. Daemon and hosting

```
$BEDROCK_HOME (default ~/.bedrock)
  config.json        { domain, creators: [emails], port, cloudflare: {...}, google: {...} }
  bedrock.sqlite     users, sessions, pebbles registry, deploy tokens
  pebbles/<name>/
    releases/<ts>/   deployed code (kept: last 3)
    current -> releases/<ts>
    data/db.sqlite, data/files/
    logs/            stdout/stderr, rotated
```

- One daemon process (`bedrock daemon`) listens on `127.0.0.1:<port>`.
- Each pebble runs as **its own Bun subprocess** (`startPebble`) on a private localhost port. The daemon routes by `Host` header, proxies HTTP and WebSockets, restarts crashed pebbles with backoff, and does zero-downtime swaps on deploy (start new, health-check, switch, stop old).
- Reserved subdomains: `auth`, `bedrock` (daemon API/dashboard), `www`.
- **Deploy**: `bedrock deploy` in a pebble directory. Local: copies to a new release. Remote: tars the directory and uploads to `https://bedrock.<domain>/api/deploy` with a creator deploy token (`bedrock login` stores it). Daemon then installs deps (`bun install --production`), migrates, swaps.
- `bedrock service install` writes a launchd (macOS) or systemd (Linux) unit for the daemon.

## 9. Cloudflare Tunnel

One-time `bedrock tunnel setup` (needs API token with *Cloudflare Tunnel: Edit* and *DNS: Edit*):
1. Create a remotely-managed tunnel (`POST /accounts/:id/cfd_tunnel`, `config_src: "cloudflare"`).
2. Put ingress config: `*.<domain>` → `http://127.0.0.1:<daemon port>`, catch-all `http_status:404`.
3. Upsert proxied DNS `CNAME *.<domain> → <tunnel-id>.cfargotunnel.com`.
4. Store tunnel token in `config.json`; the daemon supervises `cloudflared tunnel run --token ...`.

Adding a pebble needs **no** Cloudflare calls. All steps are idempotent.

## 10. Extensibility

```ts
plugin({
  name: "audit-log",
  schema: { ... },                       // extra tables
  routes: { "GET /admin/audit": handler },
  onMutation: async (ctx, name, args, next) => next(), // middleware around mutations
  onQuery: async (ctx, name, args, next) => next(),
  jobs: { prune: { cron: "0 3 * * *", run: (ctx) => {} } },
})
```

## 11. Agent-friendliness (non-negotiable)

- Every CLI command supports `--json` (machine-readable output, one JSON object on stdout) and is idempotent.
- Errors are typed (`BedrockError` with `code`, `message`, `hint`) — the hint says how to fix it.
- `bedrock dev` runs the full stack locally (daemon + pebble + fake auth) at `http://<pebble>.localhost:<port>`.
- The package ships `llms.txt` and `AGENTS.md` describing the API with copy-pasteable examples.
- Destructive commands (`db reset`, `pebble delete`) require `--yes`.

## 12. Phases

1. **Foundation** — monorepo, `config`, `db`, `runtime` (HTTP functions), CLI `init/dev/db`, `examples/notes`.
2. **Daemon** — host router, process supervisor, local deploy, releases, logs.
3. **Auth** — Google + dev login, sessions, access modes, signed identity headers.
4. **Sync** — WS protocol, read/write tracking, invalidation; `client` + `react`.
5. **Storage** — buckets, fs driver, chunked uploads.
6. **Tunnel + service** — Cloudflare setup, cloudflared supervision, launchd/systemd.
7. **Ops** — remote deploy, backups, jobs, plugins, `@bedrock/ui` (Onyx), docs/llms.txt.
