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
| Backups        | Built-in VACUUM INTO + gzip + content-addressed files → R2 or disk (no Litestream/restic) |

No Postgres, no Redis, no Docker, no reverse proxy.

Supported hosts: Windows 11, macOS, and Linux. Native Windows uses PowerShell,
Task Scheduler, NTFS access controls, directory junctions, and the built-in tar.
Windows installation uses `install.ps1`; no WSL or Developer Mode is required.
Windows device names (con, prn, aux, nul, com1–com9, lpt1–lpt9) are rejected
for pebble and bucket names before filesystem operations.

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
      backup/         snapshot/restore, retention/GC, fs and Bun.S3Client targets
      jobs/           five-field cron parser, process-local scheduler
      tunnel/         Cloudflare API client + cloudflared supervision
      client/         browser SDK (framework-agnostic)
      react/          React hooks over client/
      cli/            the `bedrock` binary
    test/
  ui/                 "@bedrock/ui" — Onyx-based components (React only)
examples/
  notes/              reference pebble, used by e2e tests
```

Public entry points of `bedrock` (package.json `exports`):

| Import            | Contents |
|-------------------|----------|
| `bedrock`         | `definePebble`, `query`, `mutation`, `bucket`, `job`, `detached`, `socket`, `service`, `plugin`, types; re-exports `drizzle-orm` operators and `drizzle-orm/sqlite-core` table builders |
| `bedrock/client`  | `createClient()`, `Connection`, client types |
| `bedrock/react`   | `BedrockProvider`, `useQuery`, `useMutation`, `useUser`, `useUpload`, `useRelease`, `useConnection` |
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
- `tokens: true` opts into per-user bearer tokens; disabled by default.
- Function context: `{ db, user, token, tokens, pebble, storage, request, invalidate, services }`. `user` is `null` when anonymous.
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
- The daemon resolves the session and forwards the user to the pebble process as `x-bedrock-user` (JSON) plus `x-bedrock-user-ts` and `x-bedrock-signature` (HMAC-SHA256). Pebble processes reject unsigned identity headers; the daemon strips incoming `x-bedrock-*` headers except `x-bedrock-file-name` and `x-bedrock-file-meta` upload metadata. A random per-boot master stays in daemon memory; each child receives only `HMAC-SHA256(master, "identity:" + pebbleName)` in `BEDROCK_IDENTITY_SECRET`. The daemon signs HTTP and WS identity with the target child’s derived secret. Signatures expire after 60 seconds.
- `access` modes:
  - `"public"` — anyone; `user` may be null.
  - `"users"` — any signed-in Google account.
  - `{ allow: ["a@x.com", "@company.com"] }` — emails or whole domains.
  - `"creators"` — only the bedrock creators list (from daemon config).
- Unauthenticated page requests to a protected pebble redirect to `auth.<domain>/login?return=...`; API/WS requests get 401.
- A localhost daemon may use dev email authentication while accepting deployments.
  Deployed releases retain data under the daemon home across redeploy/restart;
  only an explicitly attached dev source uses its source-local `.bedrock` directory.
- **Dev mode** (`bedrock dev`): no Google. A local login page lets you pick any email. Agents must be able to test auth flows without credentials.

### Pebble tokens

Opt in with `definePebble({ tokens: true, ... })`. Pebble tokens are per-user,
per-pebble credentials for native and scripted clients, separate from creator
deploy tokens. The pebble DB owns reserved `_bedrock_tokens(id, hash, user_id,
user_json, name, permissions, created_at, last_used_at, expires_at, revoked_at)`,
created through the same internal startup migration mechanism as `_bedrock_files`.
Backups and restores include it. Tokens are `brk_` plus 32 random bytes encoded as
base64url; only their SHA-256 hash is stored. Creation returns the raw token once.

`ctx.tokens.create({ name, permissions, expiresAt? })` requires a user and a
mutation slot, returns `{ id, token, name, permissions, createdAt, expiresAt }`,
and refuses token-authenticated callers. `ctx.tokens.list()` returns the current
user's non-revoked metadata (`id, name, permissions, createdAt, lastUsedAt,
expiresAt`). `ctx.tokens.revoke(id)` requires a mutation slot, only permits owned
tokens, and is idempotent. Creation/revocation participate in the caller's
transaction. Disabled methods throw `TOKENS_DISABLED`. Timestamps are Unix
milliseconds; absent expiry and unused timestamps are null.

`ctx.token` is `{ id, name, permissions }` for token authentication, otherwise
null. Detached contexts also expose it, and read/write callbacks retain it.
Jobs always have `token: null`. A valid signed daemon identity wins over bearer
authentication. Otherwise enabled pebbles resolve `Authorization: Bearer brk_…`
from the stored user snapshot; unknown, revoked, or expired credentials yield
JSON 401 `UNAUTHENTICATED`. Current pebble access policies still apply, including
allow lists and `BEDROCK_CREATORS`, on functions, routes, storage, and WS.

Permissions default to deny, and creation validates registered targets:

- `*`: everything the user could do, including WS sync.
- `query:<name>` / `mutation:<name>`: that HTTP function.
- `route:<METHOD> <path-pattern>`: the exact registered route key, including
  detached routes and plugin routes.
- `socket:<path>`: the registered application socket path, including plugins.
- `files:<bucket>:upload|read|delete`: built-in storage endpoints; all chunk
  operations, including status, require upload.

Missing grants yield 403 `FORBIDDEN` with a hint naming the needed permission.
Sync WS upgrades require `*`; application WS upgrades require `socket:<path>` or `*`; token validity and access are checked again for WS
function operations. Token permissions supplement handler and bucket policies.
Usage timestamps accumulate in memory and flush at most once per minute per
token, on a mutation or periodic internal mutation slot. SQLite writes never
happen outside the executor queue. Authentication reads also use the queue so
that they cannot observe another slot's uncommitted changes.

`createClient({ url, token })` sends the bearer on HTTP function and storage
requests with `credentials: "omit"`. Bun supports bearer WS headers; browser
WebSockets cannot supply them, so token clients in browsers use HTTP polling.
CORS for cross-origin browser extensions is a follow-up.

## 6. Sync (reactive queries)

Only when `sync: true`. Mutations, jobs, and custom routes notify after committed writes.
Drizzle writes through `ctx.db` are tracked automatically in mutations, jobs,
and routes. `invalidate()` is only needed for raw SQL via `$client` or writes
outside bedrock, notified from a mutation, job, or route. Prefer registered table
objects (`ctx.invalidate([items])`); SQL names (`ctx.invalidate(["items"])`) also
work. Unknown names throw `BedrockError("UNKNOWN_TABLE", message, hint)`.

1. Client opens one WebSocket to `/_bedrock/ws` and sends `{ op: "sub", id, query, args }`.
2. The server runs the query and records which tables it read, by capturing every SQL statement executed during the call (Drizzle logger + `AsyncLocalStorage`) and matching identifiers against the known table names.
3. Each mutation, job, and route records the tables it wrote the same way.
4. After a mutation commits, every subscription whose read-set intersects the write-set is re-run **for its own user** (permissions are just the query's `where` clause). If the result hash changed, the server pushes `{ op: "data", id, result }`.
5. Re-runs are debounced/coalesced per subscription (~16 ms) so bursts of writes cause one push.
6. Clients reconnect with exponential backoff and resubscribe automatically. Mutations over WS return `{ op: "result", id, ok, value | error }`.

Without `sync`, the same queries/mutations are callable over plain HTTP:
`POST /_bedrock/q/<name>` and `POST /_bedrock/m/<name>`.

### Seamless (phase 8)

Deploys, saves, and returning to a tab should be invisible. Nothing here adds UI;
apps may observe it through the client.

**Release identity.** The supervisor gives each child a release id: the release
directory basename, plus `-<child start ms>` in dev. It passes it as
`BEDROCK_RELEASE_ID`; a standalone `startPebble` without it uses `local-<8 random hex>`.
- The daemon proxy stamps every proxied HTTP response with
  `x-bedrock-release: <id>` and `Server-Timing: bedrock-release;desc="<id>"`
  (appended, never replacing app Server-Timing entries). Pebble code cannot spoof them;
  the proxy overwrites any values set by the child.
- The sync socket sends `{ op: "hello", release }` as its first message.

**Close codes.** A pebble that is stopping closes sync and application sockets with 1012 "Service restart".
Clients reconnect after a uniformly random 100–1000 ms, without counting it as a failed
attempt. Other closes keep the existing exponential backoff.

**Saves land before they resolve.** For a WS mutation, the server first re-runs that
socket's subscriptions whose read-set intersects the write-set (no debounce, cancelling
their pending timers), pushes any changed data, then sends `result`. Other sockets keep
the ~16 ms debounce. Guarantee: When mutate() resolves, over WS or HTTP, every subscription on the same client that the mutation changed has already delivered its new data.
HTTP mutations refresh every active subscription in parallel (`Promise.allSettled`)
before resolving, including queued mutations falling back to HTTP and clients with
polling disabled. Refresh errors reach subscriptions without rejecting a committed
mutation.
The ordinary write listener must not push the same data to that socket twice.

**Stale tabs reload themselves.** Browser clients (not token clients) know the page's
release from the navigation entry's `serverTiming` (`bedrock-release`), else the first
release they observe. They observe releases from `hello` and from `x-bedrock-release` on
any of their HTTP responses. On mismatch the client is stale:
- `client.release()` → `{ page, server, stale }`; `client.onRelease(fn)` returns unsubscribe.
  React: `useRelease()`.
- With `createClient({ autoReload })` (default `true`), a stale client calls
  `location.reload()` silently once it is safe: no queued or in-flight mutations, no
  custom `client.fetch()` requests or uploads in progress, and either the tab is hidden or the focused element is not
  editable (`input`, `textarea`, `select`, `[contenteditable]`). It re-checks on every
  mutation/custom-request/upload settle, `focusout`, and `visibilitychange`. `beforeReload?: () => boolean | void`
  may return `false` to postpone indefinitely, including hidden tabs; it is asked again on the next check. There is no forced reload deadline.
- Before reloading it saves to `sessionStorage["bedrock:restore"]`
  `{ url, at, scrollX, scrollY, scroll: {id: top}, fields: {key: value|checked} }`.
  `scroll` covers elements with an `id` and `data-bedrock-keep-scroll`. Field keys are
  the element `id`, else `name` + index among same-named fields; skip password, file,
  and hidden inputs. A new client on the same `url` within 30 s restores fields once
  their elements exist (setting values through the native setter and dispatching
  `input`/`change` so React notices), then scroll once the first data of every early
  subscription has arrived or after 2 s, retrying for up to 1 s while the page is too short.
  It then deletes the entry. A reload never happens more than once per 10 s.

**Coming back is instant.** The browser client closes its socket on `pagehide`
so the page can enter the back/forward cache, and reconnects on `pageshow`.
`online`, and `visibilitychange` to visible, cancel any pending backoff and
reconnect now with `attempt = 0`. Sent mutations pending at `pagehide` reject
with the existing disconnected error.

**Static caching (static `web` directories).**
- `.html` responses: `Cache-Control: no-cache`.
- Fingerprinted assets (a `-` or `.` followed by 8+ `[A-Za-z0-9_-]` chars containing a
  digit, right before the extension): `Cache-Control: public, max-age=31536000, immutable`.
- Everything else: `Cache-Control: no-cache`. All files get a weak `ETag` from size and
  mtime and answer `If-None-Match` with 304.
- A fingerprinted asset missing from the current release is served from the previous
  release's same web directory if present (the supervisor passes
  `BEDROCK_PREVIOUS_RELEASE`), so tabs still on old code keep loading lazy chunks.
  HTML is never served from the previous release.
- Bun HTML-bundle mode keeps Bun's own asset handling.

**Connection and HTTP freshness.** `ClientOptions.pollInterval?: number` defaults to
5000 ms; 0 preserves one-shot HTTP subscriptions. `client.connection(): Connection`
and `client.onConnection(fn: (c: Connection) => void): () => void` expose
`{ state: "idle" | "connecting" | "live" | "reconnecting" | "polling" | "offline",
since: number, attempt: number }`. `since` is Date.now() when the state last changed;
`attempt` counts consecutive failed socket attempts and is 0 when live. Listeners
are not called immediately and only fire when state changes. `idle` means no
subscriptions or pending mutations and nothing open; `connecting` is the first
socket attempt, `live` an open socket, `reconnecting` backoff/retries, and `polling`
HTTP subscription freshness. Browser `navigator.onLine === false` or a rejected
HTTP fetch puts the client offline; the next HTTP response (including an HTTP
error) or socket open restores its transport state, unless the browser still
reports offline. Closing the client releases timers, sockets and listeners.

After a failed handshake, a GET probe to `/_bedrock/ws` distinguishes outcomes:
426 retries WS with exponential backoff capped at 30 seconds; only a JSON 404
with `error.code === "NOT_FOUND"` permanently disables WS. Explicit `sync: false`,
missing WebSocket support, and browser token clients also permanently use HTTP.
401/403 report the remote error to every subscription once per distinct code until
success, keep retrying WS, and do not enable polling. Other failures, including
400, 5xx, network errors and timeouts, temporarily poll while retrying WS. On open,
polling stops and subscriptions resubscribe over WS; pending HTTP work completes.
Online, visible and pageshow events retry immediately, including temporary polling.

Each HTTP subscription queries immediately, then joins sequential polling ticks
with at most one tick in flight. Polling pauses while the document is hidden;
becoming visible immediately runs a tick and resumes the interval. Results deliver
only when their JSON serialization differs from the last delivered result. WS
messages retain their existing delivery behavior. Network failures mark offline
and keep ticking; subscription HTTP errors are reported once per distinct code,
reset on success. Unsubscribing the last subscription closes unused transport.

**Custom requests.** `client.fetch(path: string, init?: RequestInit): Promise<Response>`
resolves paths against the client URL, accepts absolute same-origin URLs and rejects
other origins with `INVALID_ARGS`. It merges caller headers, sets Origin and the
same auth as built-in requests (bearer plus omitted credentials for token clients,
otherwise included credentials), observes release headers, and prevents stale-tab
reload until it settles. HTTP errors return the Response unchanged; network errors
throw `REQUEST_FAILED` and mark offline. Successful methods other than GET/HEAD
refresh active subscriptions over HTTP before returning only while polling; WS
route writes are already pushed by the server.

**React identity and freshness.** `useConnection(): Connection` initializes from
`client.connection()` and subscribes through `onConnection`. `useQuery()` returns
`{ data, error, isLoading, connection }`; new data clears an earlier query error.
`client.user()` returns a real server User or null, throws remote errors unchanged,
and throws `OFFLINE` when its fetch rejects (including aborts/timeouts).
`useUser()` returns `{ user: User | null, isLoading: boolean,
error: BedrockError | undefined, retry: () => void }`. Loading ends at the first
answer or error. Errors preserve the last known user (initially null) and retry
at 1, 2, 4, 8, 16, then 30 seconds repeatedly. Online, becoming visible, and retry()
attempt immediately; overlapping retry requests coalesce into one next attempt.
A successful answer clears error and resets backoff. Effects clean up retries and
ignore late answers after unmount or client replacement. There is no onUser API.

Future (do not build yet): row-level diffs, optimistic updates, caches shared across clients.

## 7. Storage

- Files live in `$BEDROCK_HOME/pebbles/<name>/data/files/<bucket>/<id>`; metadata in the pebble DB table `_bedrock_files(id, bucket, owner_id, name, mime, size, sha256, created_at)`.
- `bucket(name, { maxSize, access, accept?, admit?, onStored? })`; register with `storage: [attachments]`, `access`: `"public" | "users" | "owner" | (ctx, file) => boolean`.
- Endpoints: `POST /_bedrock/files/<bucket>` (upload), `GET /_bedrock/files/<bucket>/<id>` (download with Range support), `HEAD` and `DELETE` same path.
- **Chunked uploads** are mandatory for files > 90 MiB (Cloudflare's free plan rejects request bodies > 100 MB): `POST .../uploads` → `PUT .../uploads/<uid>/<n>` → `POST .../uploads/<uid>/complete`. The client SDK chunks transparently.
- The daemon streams upload bodies and download responses, preserves Range headers, and enforces the pebble Origin on session/browser writes. Public-bucket downloads are anonymous only on public pebbles.
- Server-side API in functions: `storage.put(attachments, blobOrStream, { name, mime?, meta? })`, `storage.get(attachments, id)` (Blob), `storage.delete(attachments, id)`, `storage.list(attachments, { ownerId?, limit?, cursor? })` (metadata).
- Bucket names use `[a-z0-9_-]{1,32}`; names must be unique within a pebble. `bucket()` and `definePebble()` validate configuration with repair hints. Passing a bucket object absent from the registered array throws `BedrockError("UNKNOWN_BUCKET", …, hint)`.
- `ctx.storage` is shared across all handlers; bucket objects supply configuration without pebble-specific context inference. Function signatures remain `query(fn) | query(schema, fn)` and `mutation(fn) | mutation(schema, fn)`.
- Client APIs take bucket names inferred from `typeof pebble`: `client.upload("attachments", file)`, `client.fileUrl("attachments", id)`, `client.deleteFile("attachments", id)` and `useUpload<typeof pebble>("attachments")`. Client code does not import server bucket configurations.
- Driver interface `{ put, get, delete, stat }` — `fs` is the only built-in driver; R2 can be added later.

Bucket hooks receive `FunctionContext`. `admit(ctx, candidate)` runs before bytes
are accepted, with `{ bucket, name, mime, size, ownerId, meta }`; `size` is the
declared size or `null`. It runs again with the final size inside the commit write
transaction, before inserting `_bedrock_files`. **The commit-time check is
authoritative and serialized in the single-writer queue**, so a `SUM(size)` query
can enforce quotas without races. Keep hooks short; never perform network I/O in
an executor slot. `onStored(ctx, file, meta)` runs immediately after the file
metadata insert in that same transaction. Throwing rolls back app rows, metadata,
and the new blob. `BedrockError` is exported from `bedrock`; its code, message,
and hint pass through to clients.

Tokens and upload hooks compose: a ShareX-style upload route can use a pebble
token granting `files:assets:upload`, while `admit` and `onStored` record
`ctx.token.id` with the uploaded file. Staged uploads retain the same user and
token across authorization and commit slots; every slot checks permissions.
Chunk status (`GET .../uploads/<uid>`) requires upload permission too.
Token clients omit cookies on fetch and XHR; browser session uploads retain them.

For example, with an app-defined `used(db, ownerId)` performing `SUM(size)`,
`QUOTA`, and a registered `assetRows` table:

```ts
import { bucket, BedrockError } from "bedrock";
export const assets = bucket("assets", {
  maxSize: "2gb", access: "owner",
  admit: ({ db, user }, file) => {
    if (file.size !== null && used(db, user!.id) + file.size > QUOTA)
      throw new BedrockError("QUOTA_EXCEEDED", "Your safe is full.", "Delete files or ask for more space.");
  },
  onStored: ({ db }, file, meta) => {
    db.insert(assetRows).values({ fileId: file.id, ownerId: file.ownerId, size: file.size }).run();
  },
});
```

Upload `meta` is untrusted JSON: apps must validate it in `admit`/`onStored`
before using it. It is passed to hooks and persisted in chunk manifests, never
stored in `_bedrock_files`. Single uploads send percent-encoded JSON in
`x-bedrock-file-meta`; chunk start sends a `meta` JSON field. Both are limited to
4 KiB after percent encoding. Server puts accept `{ name, mime?, meta? }` and run
both hooks too. Their Blob/stream work stays inside the caller's transaction;
server code is trusted to avoid slow network streams there.

HTTP upload bodies stream into `data/uploads/staging/<uuid>` outside executor
slots. Single uploads use a short read slot for authorization/admission, stream
with a cap of min(bucket maxSize, 90 MiB), then use a short write slot to re-check
access/admission, rename the staged file into place, insert metadata, and run
`onStored`. Chunk assembly and hashing also happen outside slots. Each upload id
has its own serialization lock; different uploads can stream concurrently.
Staging is deleted on controlled failures/disconnects and stale staging (>24 h)
is cleaned at startup and hourly. Sync invalidation fires only after commit.

Chunk protocol: `POST .../uploads` with `{ name, mime?, size, sha256?, meta? }`
returns `{ uploadId, chunkSize }`. `PUT .../uploads/<uid>/<n>` sends sequential
32 MiB chunks (last may be shorter); replacement is atomic. `GET .../uploads/<uid>`
returns `{ uploadId, size, chunkSize, received: number[] }`, listing only complete
chunks, with the same user/bucket authorization. `POST .../uploads/<uid>/complete`
accepts no body or `{ sha256 }`. Digests are lowercase hex SHA-256; if declared at
start or completion, each must match the assembled bytes or completion throws
`UPLOAD_CHECKSUM_MISMATCH`. Size is always verified. Upload state expires after
24 hours and survives restarts.

`client.upload(bucket, file, { onProgress?, signal?, meta?, uploadId?, onUploadId? })`
uses XHR byte-level progress in browsers and fetch transport-boundary progress in
Bun. Progress is a 0–1 fraction across the file. Chunks remain sequential with up
to three attempts; FORBIDDEN, UNAUTHENTICATED, INVALID_CHUNK, FILE_TOO_LARGE and
QUOTA_EXCEEDED are never retried. SHA-256 is incremental: the client reads one
chunk at a time and sends the digest at completion, without a whole-file memory
allocation or hashing pre-pass. Cookies and abort signals work on both transports.
Save `onUploadId(id)` to resume later with `uploadId` and the original local File.
Resume checks status, hashes received chunks locally without re-sending them,
and sends missing chunks. An expired handle starts a fresh upload. `useUpload`
passes all these options through and keeps its existing return shape.

## 8. Daemon and hosting

```
$BEDROCK_HOME (default ~/.bedrock)
  config.json        { domain, creators: [emails], port, cloudflare: local or remote tunnel metadata, google: {...} }
  setup.json         versioned checklist with completion timestamps and deferred steps
  cloudflared/       local mode: cert.pem, credentials.json (0600), config.yml
  backup-credentials R2 access key/secret (0600); config.json stores only target metadata
  backup-state.json  last successful full/per-pebble backup times
  tunnel-token       Cloudflare tunnel run token (0600); API token is never persisted
  logs/cloudflared.log  rotated cloudflared output (run token redacted)
  bedrock.sqlite     users, sessions, pebbles registry, deploy tokens
  pebbles/<name>/
    releases/<ts>/   deployed code (kept: last 3)
    current -> releases/<ts>  (directory junction on Windows)
    data/db.sqlite, data/files/
    logs/            stdout/stderr, rotated
```

- `bedrock setup` is a guided, resumable CLI wizard: prereqs, identity, cloudflare,
  google, backups, service, verify. It marks a step complete only after success in
  `$BEDROCK_HOME/setup.json`; failures resume at the first incomplete step.
  `setup <step>` redoes one step; `setup --status [--json]` prints the checklist.
  Identity changes invalidate tunnel/service/verification; other configuration
  steps invalidate service/verification. Explicit skip choices are recorded.
  Each prompt has a flag; non-TTY, `--yes`, and `--json` never prompt. Missing
  choices yield `SETUP_FLAGS_MISSING` with flag hints before any setup mutations.
  Setup checks daemon health after service installation/restart, runs doctor,
  and polls creator session presence through the authenticated status API.
- `bedrock new <name> [--template react|minimal]` defaults to React, installs
  dependencies, generates schema migrations and makes a first Git commit when
  Git exists. `init <name>` scaffolds in the current empty directory. Dev needs
  no host configuration. Source installs use checkout-relative first-party
  `file:` dependencies; daemon deployment substitutes its own first-party packages.
- The creator dashboard at `bedrock.<domain>/` uses Google session authorization;
  it redirects to sign-in and lists pebble links for creators only. CLI status
  includes domain, creator session presence and the current token's creator email
  (older/manual tokens have no recorded identity). It never returns session tokens.
- One daemon process (`bedrock daemon`) listens on `127.0.0.1:<port>`.
- Pebble bearer requests (`Authorization: Bearer brk_…`) without any
  `bedrock_session` cookie bypass daemon Origin/access checks and identity signing;
  Authorization is forwarded unchanged and the runtime enforces token access.
  They never redirect to login. This is safe from CSRF because bearer credentials
  are explicit rather than ambient browser identity. If any session cookie is
  present (even empty or invalid), existing Origin/session rules apply and the
  bearer is ignored. Incoming identity headers are still stripped.
- Each pebble runs as **its own Bun subprocess** (`startPebble`) on a private localhost port. The daemon routes by `Host` header, proxies HTTP and WebSockets, restarts crashed pebbles with backoff, and does zero-downtime swaps on deploy (start new, health-check, switch, stop old).
- Reserved subdomains: `auth`, `bedrock` (daemon API/dashboard), `www`.
- **Deploy**: `bedrock deploy` in a pebble directory. Local: copies to a new release. Remote: tars the directory and uploads to `https://bedrock.<domain>/api/deploy` with a creator deploy token (`bedrock login` stores it). Daemon then installs deps (`bun install --production`), migrates, swaps.
- `bedrock service install|uninstall|status` manages a macOS **LaunchAgent**
  (`~/Library/LaunchAgents/dev.bedrock.daemon.plist`, RunAtLoad/KeepAlive) or Linux
  **systemd user** unit (`~/.config/systemd/user/bedrock.service`, Restart=always).
  Units use absolute Bun/CLI paths and BEDROCK_HOME. `install --dry-run` prints the
  file without writing it or invoking the service manager. Linux users can run
  `loginctl enable-linger "$USER"` for startup without login; macOS runs at user login.
- Windows 11 service commands manage a per-user Scheduled Task with an interactive
  logon trigger, least privilege, unlimited runtime and restart on failure. Its
  hidden PowerShell launcher pins Bun/CLI paths and BEDROCK_HOME. It starts at
  login and runs while the user is logged in; it requires no elevation. Task names
  are scoped to the user and home. Private files grant access to the owner and
  SYSTEM through NTFS ACLs. Windows junction swaps stage the previous junction
  before replacement; live HTTP routing continues through the supervisor's child
  reference and SQLite registry remains authoritative after a host crash.
- `bedrock login <domain>` (also `bedrock.<domain>` or an HTTPS URL) opens a browser and a one-shot
  random-port callback on 127.0.0.1. `/cli-login` requires a signed-in creator,
  then explicit confirmation to mint a deploy token. Confirmation is bound to the
  session, single-use, expires after five minutes, and requires the exact Origin.
  The callback state is random and checked before accepting the token. Repeating
  login verifies and reuses valid credentials; logout is required before switching
  servers.
- CLI credentials are `{url, token}` in `~/.config/bedrock/credentials.json`
  (or `$XDG_CONFIG_HOME/bedrock/credentials.json`), mode 0600. Explicit URL/token
  flags override environment variables; the reachable local daemon takes priority
  over saved remote credentials. An explicit URL can use a saved token only for
  its matching origin. Tokens are never forwarded through HTTP redirects.
- `bedrock logout` revokes the saved token remotely before deleting credentials;
  offline failure retains credentials for retry. `bedrock token create|ls|revoke <id>`
  manages hashed deploy tokens; ls returns IDs and creation times, never raw tokens.
  Creator deploy tokens grant full daemon operations, including token management.
- `bedrock doctor` checks Bun, local daemon/configuration, domain/creators, OAuth,
  cloudflared installation/process, tunnel ingress/DNS via the API when a transient
  API token is available, wildcard resolution via Cloudflare DoH, available disk,
  each pebble's live health, and backup age (warn when > 2× interval). Offline DNS and unavailable API credentials are
  skipped warnings; any failed check sets exit code 1. `doctor --json` emits an
  array of checks `{name, status: pass|warn|fail, message, hint, skipped?}`.

## 9. Cloudflare Tunnel

Default setup uses a **locally managed tunnel**; no API token or account/zone IDs
are requested. `cloudflared tunnel login` opens browser authorization. Because
login writes to `~/.cloudflared` regardless of `--origincert`, Bedrock isolates
its HOME during login and moves the certificate to `$BEDROCK_HOME/cloudflared/`.
Commands thereafter pass `--origincert` explicitly. Setup finds or creates
`bedrock-<hostname>` and runs `cloudflared tunnel route dns <id> "*.<domain>"`.
It runs `route dns --help` as a compatibility check; Cloudflare's
[route implementation](https://github.com/cloudflare/cloudflared/blob/master/cmd/cloudflared/tunnel/subcommands.go)
validates DNS hostnames with wildcard support. Existing routes are reused;
conflicts are reported. If CLI DNS routing fails, repeating the step with
`--api-token` uses the DNS API after zone discovery without migrating the tunnel.

Local metadata is `{mode: "local", tunnelId, name, credentialsFile, configFile}`.
The mode-0600 YAML has tunnel ID, credentials path, ingress `*.<domain>` to
`http://127.0.0.1:<port>` and `http_status:404` catch-all. The daemon supervises
`cloudflared tunnel --no-autoupdate --config <file> run` with no run token.

For unattended setup, `--api-token` or `CLOUDFLARE_API_TOKEN` selects the existing
**remotely managed tunnel** implementation. `GET /zones?name=<domain>` discovers
zone/account IDs; the token needs Zone: Read, Cloudflare Tunnel: Edit and DNS: Edit.
`bedrock tunnel setup --api-token <token>` also discovers IDs; legacy explicit
`--account-id`/`--zone-id` flags remain supported.

1. Find or create a non-deleted `bedrock-<hostname>` tunnel with
   `config_src: "cloudflare"`. Mode conflicts are errors, never implicit migrations.
2. Re-PUT wildcard ingress and the 404 catch-all.
3. Upsert the proxied wildcard CNAME to `<id>.cfargotunnel.com`; conflicting DNS
   records require explicit repair.
4. Save only the run token in `$BEDROCK_HOME/tunnel-token` (0600), and remote
   metadata `{mode?: "remote", accountId, zoneId, tunnelId, dnsRecordId, name}`.
   The API token is never persisted. The daemon passes `TUNNEL_TOKEN` in the
   child's environment, never argv, and redacts it in rotated logs.

cloudflared is the only external host dependency. Missing binary/startup/connection
failures do not stop local serving; restart backoff caps at 30 seconds.
`tunnel status`/doctor check local credentials and YAML for local mode, plus DNS
when a transient API token is available; remote mode checks ingress/DNS via API.
Both also use doctor's independent wildcard DoH check.
`tunnel teardown --yes --api-token <token>` safely deletes only matching DNS and
the saved tunnel in either mode. Local mode discovers its account/zone first,
then removes its credentials and YAML. Stop the daemon before teardown.
Repeating setup/teardown is safe; adding pebbles needs no Cloudflare calls.

## 10. Extensibility

```ts
import { plugin, job, sqliteTable, text, integer, lt } from "bedrock";

const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
});

plugin({
  name: "audit-log",
  schema: { auditLog },
  routes: { "GET /api/audit": (_request, _server, ctx) => Response.json(ctx.db.select().from(auditLog).all()) },
  onMutation: async (ctx, name, args, next) => next(),
  onQuery: async (ctx, name, args, next) => next(),
  jobs: { prune: job("0 3 * * *", async ctx => {
    ctx.db.delete(auditLog).where(lt(auditLog.createdAt, Date.now() - 30 * 86400000)).run();
  }) },
})
```

Drizzle job and route writes notify sync automatically after commit. For raw SQL:

```ts
ctx.db.$client.exec("DELETE FROM audit_log WHERE created_at < 0");
ctx.invalidate([auditLog]);
```

- Plugin schema/routes/jobs/sockets/services merge into the pebble. Duplicate plugin names, export
  keys, SQL table names, route keys, and job names fail with repair hints.
  Plugin tables are included in the pebble's normal `bedrock db generate` flow.
- Middleware wraps validated query/mutation arguments inside their transaction,
  in plugin array order (A before → B before → handler → B after → A after).
  It can return without next() to short-circuit. Query middleware remains read-only.
  Hooks do not wrap routes, jobs, or storage HTTP operations.
- `jobs: { name: job(cron, async ctx => ...) }` is supported on pebbles and plugins.
  Five numeric cron fields support `*`, lists, ranges, and steps in server-local
  time. Restricted day-of-month/day-of-week use traditional OR semantics.
  By default, jobs execute in the pebble's write queue with `user: null` (bypassing pebble
  access, retaining bucket policies), invalidate sync after commit, log named
  failures, and skip overlapping runs of the same job. There is no catch-up or
  persisted history; overlap protection is process-local.
- `bedrock jobs ls <pebble>` and `jobs run <pebble> <job>` use the authenticated
  daemon API and a signed service identity to the child.
- Route handlers keep `(request, server)` and receive FunctionContext as a third
  argument, including `{ db, user, storage, invalidate }`. By default they run inside write
  transactions. Daemon access gating applies to all routes; direct low-level
  routes retain existing Bun behavior for signed/anonymous identity; token users
  are also gated by the runtime. Functions and jobs also expose invalidate.

Routes and jobs can opt out of the outer queue/transaction for slow network I/O:

```ts
import { detached, job } from "bedrock";

routes: { "POST /api/refresh": detached(async (_request, _server, ctx) => {
  const rows = await fetch("https://example.com/items").then(r => r.json());
  await ctx.write(({ db }) => db.insert(items).values(rows).run());
  return Response.json(await ctx.read(({ db }) => db.select().from(items).all()));
}) },
jobs: { refresh: job("0 * * * *", async ctx => {
  const rows = await fetch("https://example.com/items").then(r => r.json());
  await ctx.write(({ db }) => db.insert(items).values(rows).run());
}, { transaction: false }) },
```

`DetachedContext` exposes `{ user, token, pebble, request, read, write, services }`, without direct
`db`, `storage`, or `invalidate`; accessing those throws a repair-hinted
`BedrockError`. `read(fn)` and `write(fn)` resolve the callback's value in short
queued slots with the same FunctionContext and transaction/storage/tracking
semantics as queries and mutations. No query/mutation plugin middleware wraps
these callbacks. Await every slot, keep network I/O outside callbacks, and do not
retain a slot's context. A failed slot rolls back only itself; earlier committed
slots survive later handler errors. Writes notify sync after each commit.
Detached routes retain daemon access gating and signed user identity, just like
ordinary routes. Jobs keep `user: null` in every slot, process-local overlap
protection, scheduling, and `bedrock jobs run`. Existing routes/jobs remain
transactional by default.

### Application sockets and long-lived services

Pebbles and plugins may declare application sockets independently of sync:

```ts
import { definePebble, socket, service } from "bedrock";
export default definePebble({
  name: "host", access: "users",
  services: { counter: service({
    stopTimeout: 5000,
    start(ctx) { ctx.log("Starting", ctx.dataDir); return { count: 0 }; },
    stop(value) { value.count = 0; },
  }) },
  sockets: { "/api/host": socket<number>({
    maxMessageSize: "16mb",
    // Optional: backpressureLimit: "32mb",
    open(ws, ctx) { ws.data.value = ctx.services.counter.count; },
    message(ws, data, ctx) { ws.send(data); },
    close(ws, code, reason, ctx) {},
    drain(ws, ctx) {},
  }) },
});
```

Socket paths are absolute and outside `/_bedrock`; duplicate plugin socket paths
and service names fail configuration validation. A socket cannot share a GET
route. One Bun WebSocket handler dispatches sync and application connections by
socket data kind. Upgrades use the sync identity/access checks and require token
`socket:<registered path>` or `*`. Bearer validity is checked on messages and
read/write slots; daemon session sockets are revalidated every five minutes and
closed with 4001 on expiry/revocation (logout closes them immediately). The daemon
relays application text/binary frames and close codes, and Bun clients can send
Authorization headers. Browser clients use session cookies and ordinary
`new WebSocket(new URL("/api/host", origin.replace(/^http/, "ws")))`.

Callbacks receive detached contexts; no executor slot lasts for a connection.
Use `ctx.read`/`ctx.write` for short database work; writes notify sync. Native Bun
`send`, `getBufferedAmount`, and `drain` expose backpressure. `ws.data.value` is
application-owned per-connection state (type parameter of `socket<T>`).
`socket({ maxMessageSize?, backpressureLimit?, ...handlers })` accepts positive
integer bytes or size strings such as `"16mb"` (binary units). Incoming application
messages default to 1 MiB. Limits count UTF-8 bytes for text and bytes for binary,
not characters. The single Bun handler's ceilings accommodate the largest declared
socket; dispatch enforces each connection's own message limit with 1009
"Message too big". Bun rejects frames exceeding its overall ceiling before dispatch
(and may terminate them without a close frame). Sync retains its 64 KiB input
limit and existing slow-consumer closure behavior.

Application sockets do not close on backpressure by default. `send`, `sendText`
and `sendBinary` preserve Bun's return values: -1 means queued with backpressure,
0 means dropped, positive values mean sent bytes. Stop sending on -1, inspect
`getBufferedAmount()`, and continue from `drain`; applications own this throttling.
An optional per-socket `backpressureLimit` closes with 1013 "Slow consumer" when
buffered output exceeds it. Native topic publish/fanout is outside this per-send
check; use per-connection sends for bounded application protocols. Without a
configured limit, Bun's output ceiling is 2 GiB minus one; it is not a safe queue
size to target. Callback failures log and close with 1011. Applications own their
protocol, row authorization and reconnect policy.

The daemon accepts frames up to 64 MiB and bounds each relay direction's send
queue to 64 MiB (checked before enqueueing); the pre-upgrade queue is bounded to
64 MiB and 100 messages. For upstream-to-downstream backpressure it pauses Bun
client reads and resumes them on downstream drain. Already decoded frames can
still arrive: exceeding the byte budget closes both sides with 1013 "Slow
consumer". On older Bun versions without pause/resume, the same close bound
applies. Downstream-to-upstream sends check `bufferedAmount` and close both sides
before exceeding the bound. Whole 10 MiB text and binary messages are supported;
frame larger transfers or use HTTP. The bound covers queued payload bytes, not
WebSocket framing overhead or the currently decoded input frame.

`service({ start(ctx), stop?(value), stopTimeout?: milliseconds })` returns the awaited start value to all
function, route, socket and job contexts through `ctx.services`. ServiceContext
is `{ pebble, dataDir, read, write, log, signal }`; raw SQL invalidation belongs
inside `write` through its FunctionContext. It has no lifetime transaction.
Services start in map declaration order (pebble entries, then plugins in array
order), after migrations and before HTTP/health and child readiness. A failed
start throws hinted `SERVICE_START_FAILED`, aborts the signal and unwinds earlier
services. Later startup failures also unwind services.

Stopping closes the listener, sends 1012 "Service restart" to sockets, aborts
the service signal, invokes stops in reverse order within a shared deadline,
then stops jobs/executor/database. The deadline is the maximum declared
`stopTimeout`, at least 2000 ms and capped at 30000 ms (positive integer
milliseconds). It is one budget for all services, not a fresh timeout per stop.
The child reports this budget before service startup and again at readiness;
the supervisor allows the budget plus 1000 ms before SIGKILL for stop and swap
cleanup. The default remains three seconds. Retired releases first get up to
three seconds to drain HTTP requests. SIGTERM and IPC stop both run
this cleanup. Crashes/forced kills cannot guarantee cleanup. New release services
may overlap old ones during a health-gated swap: coordinate shared resources.
In-memory state such as terminal sessions does not survive deploys/restarts.
`ServicesOf<typeof pebble>` derives service values; annotate
`FunctionContext<ServicesOf<typeof pebble>>` or `DetachedContext<...>` (using a
separate services definition to avoid circular inference) for checked handler
service names/results. Helper callbacks otherwise retain the open service map.

### Built-in backups

The daemon checks scheduling each minute, with default interval 60 minutes.
`backup setup --dir <path>` selects disk; R2 flags select Bun.S3Client at the
account endpoint (native listing when available, signed ListObjectsV2 fallback
on Bun 1.2). Credentials are saved separately, mode 0600. No external
backup binaries or runtime dependencies are used.

A live `VACUUM INTO` snapshot is gzipped at
`pebbles/<name>/db/<filename timestamp>.sqlite.gz`; `_bedrock_files` metadata selects
content-addressed `pebbles/<name>/files/<sha256>` uploads only when absent. A
manifest at `pebbles/<name>/manifests/<filename timestamp>.json` records DB key/checksum,
file id→sha256, version, and migration names/hashes. Publish it last. The daemon's
identity DB is snapshotted under `daemon/db/` and `daemon/manifests/` too.
Filename timestamps replace ISO time colons with hyphens on every platform;
manifest timestamps and `--at` retain ISO format. Existing backup keys remain
readable and restore/pruning use the manifest's stored database key.

Retain newest representatives of 24 hourly and 30 daily UTC buckets, prune old
DBs/manifests, and GC file blobs unreferenced by remaining manifests. Configurable
`backup.intervalMinutes`, `hourly`, and `daily` are stored with target metadata.
`backup run [pebble]` also snapshots identity; `backup ls <pebble>` lists snapshots.
`backup restore <pebble> [--at <exact-ts>] --yes` stops the pebble, verifies SQLite
integrity and DB/file SHA-256, stages and swaps data directories, preserves
`data.before-restore-<timestamp>-<suffix>`, then starts selected code. Starting
can apply newer migrations. The two renames occur while stopped; a host crash
between them requires recovering the preserved directory. Release code, config,
and secrets need separate backups; daemon identity restore is offline.

Pebbles can opt plain trees into the same backup target:
`backup: { directories: ["workspaces"], exclude: ["**/node_modules/**"] }`.
Roots are relative to dataDir, nonoverlapping and outside reserved db.sqlite,
files and uploads; absolute paths, dot segments and backslashes are rejected.
The walker skips symlinks and special files, records regular files and empty
directories, and hashes exactly the bytes read. Glob exclusions match paths
relative to dataDir (including the configured root). The manifest adds
`directories: { [root]: [{ path, sha256, size, mode, mtimeMs }] }` and
`emptyDirs: { [root]: [relativePath] }` (empty string denotes the root).
Blobs share `pebbles/<name>/files/<sha256>` with bucket files on fs and R2, and
retention GC includes both references. Restore validates paths/checksums/size,
recreates directories and restores file modes/mtimes in the staged data tree.
Older manifests remain compatible. `backup run`, `ls`, and `restore` include
these trees; the run loads the selected release's backup configuration.
Directory snapshots are best effort while services are live: no quiesce hook,
no multi-file consistency guarantee, metadata may precede changed bytes, and
concurrent deletion can fail a snapshot. Keep transactional state in SQLite.

Rollback refuses target code missing applied migrations unless `--force`; its
hint points to backup restore. `bedrock --version` prints package version; `bun
link` from packages/bedrock registers the CLI on PATH.

### Trust model

Creators are trusted. Pebbles are separate processes with no OS isolation and
can access server resources as the daemon user. Security boundaries protect
against end users and the internet, not hostile creators.

## 11. Agent-friendliness (non-negotiable)

- Every CLI command supports `--json` (machine-readable output, one JSON object on stdout, except doctor returns its checks array) and is idempotent.
- Errors are typed (`BedrockError` with `code`, `message`, `hint`) — the hint says how to fix it.
- `bedrock dev` runs the full stack locally (daemon + pebble + fake auth) at `http://<pebble>.localhost:<port>`.
- The package ships `llms.txt` and `AGENTS.md` describing the API with copy-pasteable examples.
- Destructive commands (`db reset`, `pebble delete`) require `--yes`.

## 12. Phases

1. **Foundation — done** — monorepo, `config`, `db`, `runtime` (HTTP functions), CLI `init/dev/db`, `examples/notes`.
2. **Daemon — done** — host router, process supervisor, local deploy, releases, logs.
3. **Auth — done** — Google + dev login, sessions, access modes, signed identity headers.
4. **Sync — done** — WS protocol, read/write tracking, invalidation; `client` + `react`.
5. **Storage — done** — buckets, fs driver, chunked uploads.
6. **Tunnel + service + remote ops — done** — Cloudflare setup/supervision, launchd/systemd user services, doctor, creator CLI login, deploy token management.
7. **Ops — done (7a UI, 7b backups/jobs/plugins/polish)** — remote deploy, backups, jobs, plugins, `@bedrock/ui` (Onyx), docs/llms.txt.
8. **Seamless — done** — release identity, 1012 restarts, saves land before they resolve, stale-tab reload with place restore, instant reconnect + bfcache, static caching.

Custom HTTP routes may set `definePebble({ maxRequestBodySize: bytes })` (positive integer, default 90 MiB, maximum 1 TiB). The daemon ceiling is 1 TiB and forwards request bodies as streams; custom routes must stream them to bound memory. Storage bucket limits remain separate. Application sockets retain the original URL and headers before upgrade, including on Bun 1.2.
