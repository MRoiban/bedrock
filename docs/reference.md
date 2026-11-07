# Bedrock — Implementation reference

[ARCHITECTURE.md](../ARCHITECTURE.md) holds the principles. This reference records
implementation details; [the author guide](../packages/bedrock/AGENTS.md) covers
building pebbles.

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
| Migrations     | drizzle-kit diffs the schema against replayed SQL; bedrock writes and applies it |
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
| `bedrock`         | `definePebble`, `query`, `mutation`, `bucket`, `job`, `detached`, `socket`, `service`, types; re-exports `drizzle-orm` operators and `drizzle-orm/sqlite-core` table builders |
| `bedrock/client`  | `createClient()`, `Connection`, client types |
| `bedrock/react`   | `BedrockProvider`, `useQuery`, `useMutation`, `useUser`, `useUpload`, `useRelease`, `useConnection` |
| `bedrock/daemon`  | `startDaemon()`, daemon options |
| `bedrock/server`  | `startPebble()` (low-level, used by daemon and tests) |
| bin `bedrock`     | CLI |

`@bedrock/ui` depends on the published
[`@mroiban/onyx`](https://github.com/MRoiban/onyx) release tarball and re-exports
every Onyx primitive. To upgrade, change the release URL in `packages/ui/package.json`,
run `bun install`, then `bun run build:css` in `packages/ui`, and commit the lockfile
and `dist/styles.css`. The stylesheet is Onyx's prebuilt CSS (all layers and the
codicon font) followed by Bedrock's layouts; pebbles need no CSS build step. Theme palettes and component
defaults come from Onyx, with Bedrock supplying its web layouts. Select menus
follow the trigger’s computed typography across portals, including application
font-size overrides. Compact host buttons (`size="native"`) preserve child layout;
`Panel variant="docked"` supplies a shared workbench surface without card borders,
rounding or shadows. Docked panels clip and isolate positioned content so it
stays within the panel during resizing. Floating menus/popovers follow the
Onyx host typography and UI geometry scales.

Modules talk through exported TypeScript interfaces only. No module reaches into
another's internals. Features compose through plain exported objects.

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
  name: "notes",                        // subdomain; 1–32 lowercase letters/digits/hyphens; letter/digit at both ends
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
});
```

Rules:
- `query(fn)` / `query(schema, fn)` and `mutation(fn)` / `mutation(schema, fn)`. Args are validated with the Standard Schema if given.
- `tokens: true` opts into per-user bearer tokens; disabled by default.
- Function context: `{ db, user, token, tokens, pebble, storage, request, invalidate, services }`. `user` is `null` when anonymous.
- Queries are read-only (enforced: run inside a read transaction). Mutations run inside a write transaction.
- Types flow end-to-end: the client infers query/mutation names, args and results from `typeof pebble`.

### Errors

`new BedrockError(code, message, hint, detail?, { status?, data? })`; the first four
arguments are unchanged. `data` is optional JSON context sent as `error.data`
(after a `JSON.stringify` round trip). If it cannot be serialized (cycles, BigInt),
it is dropped with a `console.warn` and the error is otherwise sent normally.

Functions, routes (including `publicRoute` and `detached`), file endpoints and
WebSocket error frames use one status rule, first match wins:

1. `status`, if it is an integer from 400 to 599.
2. Bedrock's table: `*_NOT_FOUND` for functions, files, buckets and uploads → 404;
   `UNAUTHENTICATED` → 401; `FORBIDDEN`, `INVALID_IDENTITY` → 403;
   `DISK_FULL` → 507; `FILE_TOO_LARGE` → 413; `LOGIN_LIMIT` → 429; `PEBBLE_STOPPED` → 503;
   `READ_ONLY`, `UNKNOWN_TABLE`, `UNKNOWN_BUCKET`, `DETACHED_CONTEXT`,
   `NETWORK_IN_SLOT`, `TOKENS_DISABLED`, `OAUTH_NOT_CONFIGURED` → 500 (programming or server faults);
   storage rejections (`QUOTA_EXCEEDED`, `FILE_TYPE_REJECTED`, …) → 400.
3. `NOT_FOUND` or `*_NOT_FOUND` → 404; `CONFLICT` or `*_CONFLICT` → 409;
   `RATE_LIMITED` → 429; `INVALID_*` → 400.
4. Any other deliberately thrown `BedrockError` → 400.
5. A non-`BedrockError` throw is wrapped (`FUNCTION_FAILED`, `INTERNAL_ERROR`) → 500.

WebSocket `result` (with `ok: false`) and `error` frames carry the same number as
`status` beside `error`. Clients rebuild `BedrockError` with `data` and `status`
(the HTTP status, or the frame's), and the React hooks return that object as `error`.

```ts
// 01:30 happens twice when clocks go back; let the user pick a reading.
throw new BedrockError("TIME_CONFLICT", "This local time is ambiguous.",
  "Choose the earlier or later reading.", undefined,
  { data: { candidates: ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"] } }); // 409
```

SQLite `SQLITE_FULL` (including wrapped driver errors) and filesystem
`ENOSPC`/`EDQUOT` become `DISK_FULL`, naming the affected path/filesystem and
asking the operator to remove old backups/logs/releases or increase quota.
Reads remain available and failed writes do not poison the queue; writes resume
on retry after space is freed, without restarting. SQLite can auto-roll back on
FULL, so rollback only runs while the connection is still in a transaction.
Daemon logs drop disk writes on exhaustion with one stderr notice per outage;
they retry on incoming log output at most once per minute.

`bedrock doctor` (also `--json`) reports available and total bytes for the home
filesystem and configured data directory. It warns below 1 GiB or 5% available.
There is no background disk-space polling. Deploys reject with `DISK_FULL`
before reading the upload if its declared size plus 64 MiB cannot fit; before
extraction they check gzip's uncompressed-size lower bound plus 64 MiB.
Dependency installation and concurrent writers can still exhaust space;
the previous release remains selected when deployment fails before activation.

## 4. Database

- File: `<data root>/pebbles/<name>/data/db.sqlite` (the data root is `dataDir`, default `$BEDROCK_HOME`; see §8), opened with `PRAGMA journal_mode=WAL; synchronous=NORMAL; foreign_keys=ON; busy_timeout=5000`. `synchronous=NORMAL` avoids disk sync on most commits (WAL header reuse can still sync): in WAL mode a process crash loses nothing, and a power loss can drop only the most recent commits, never corrupt the file. The daemon's `bedrock.sqlite` uses the same pragmas.
- On SQLite builds safe from the WAL-reset bug, pebble writers set `wal_autocheckpoint=0`. SQLite 3.7.0 through 3.51.2 is vulnerable, except patched 3.44.x ≥ 3.44.6 and 3.50.x ≥ 3.50.7. Bedrock reads `sqlite_version()` from the writer; vulnerable or unrecognized versions keep 1,000-page auto-checkpoint, never start a checkpoint Worker (including shutdown), and log one `DATABASE_CHECKPOINT_UNSAFE_SQLITE` warning per open with an upgrade hint. Upgrade Bun / use a Bun build with newer SQLite; Bun on macOS may use system SQLite. See [SQLite WAL-reset bug](https://www.sqlite.org/wal.html#walresetbug). Bedrock samples WAL size asynchronously every 250 ms, rather than statting on each commit, and starts a short-lived Bun Worker around 1,000 pages (normally 4 MiB). Its separate connection performs a PASSIVE checkpoint without waiting for readers. On SQLite versions with NOOP support it first checks the pending frame count, so reusing an allocated WAL does not cause premature checkpoints. At the backstop it also attempts a non-waiting TRUNCATE to reclaim the file. Attempts are at least one second apart; idle pebbles have no checkpoint Worker. The daemon's `bedrock.sqlite` keeps SQLite's normal auto-checkpoint behavior.
- A slow checkpoint can also fall behind an active writer; each Worker makes up to three PASSIVE passes to catch up. At 64 MiB of sampled WAL, the next queued write holds its slot for up to 5 seconds while a TRUNCATE checkpoint runs, so writes and queued reads pause instead of failing. If a held reader still blocks it, that write fails with `DATABASE_WAL_BUSY`, and later writes fail immediately for 5 seconds so the queue does not back up; reads continue. Finish held read transactions, including backups, and retry. This backstop permits one polling interval and one transaction of overshoot; keep transactions short. Raw `db.$client` writes inside queue slots share the protection. Standalone scripts bypass the queue's admission check: yield between bounded batches, and avoid long-lived readers. SQLite auto-checkpoint also cannot bound a WAL pinned by a reader.
- A Worker startup/runtime failure or a 30-second checkpoint watchdog restores the writer's 1,000-page SQLite auto-checkpoint and logs `DATABASE_CHECKPOINT_FAILED` with a repair hint. Commits can pause in this degraded mode. Bedrock retries automatically after 30 seconds, doubling after each failure up to 10 minutes, even on an idle WAL. Repeated failures in one degraded episode do not repeat the warning. Only a successfully completed Worker restores `wal_autocheckpoint=0` and logs `DATABASE_CHECKPOINT_RECOVERED` once; a new episode resets the backoff. Shutdown/close cancels retries. The 64 MiB admission backstop remains active in degraded and unsafe-build modes: while holding the queue slot, the writer attempts a non-waiting TRUNCATE without another connection, then applies the same bounded wait and `DATABASE_WAL_BUSY` behavior. Fix Worker support, permissions or storage to allow recovery. Off-thread checkpoints remove automatic checkpoint work from normal commits, but SQLite locks, WAL reuse and storage contention can still delay a write.
- Runtime shutdown stops monitoring and hands the final checkpoint and last-connection close to a Worker, with up to 500 ms inside the supervisor's extra shutdown allowance. An unfinished checkpoint is cancelled and logs `DATABASE_CHECKPOINT_STOPPED`; committed WAL data remains recoverable. Forced exits need no Worker cleanup for recovery. Preserve `db.sqlite` and its `-wal` together when moving a stopped database; never delete a WAL by hand. `bedrock dev` uses the same lifecycle. Backup Workers open the source read-only: `VACUUM INTO` writes only the separate destination, so it does not introduce a source writer/checkpointer. Rollback migration inspection also opens read-only. Closing the last writable connection can checkpoint, but SQLite coordinates last-close cleanup with other connections; it is not a concurrent background checkpoint while a writer remains open. `bedrock data move` requires a stopped daemon and copies files without opening SQLite; doctor does not open pebble databases. Release deploy/restart/rollback refuses to launch alongside a live child on vulnerable builds (`DATABASE_UNSAFE_SQLITE`); upgrade Bun or stop the pebble first. Local `db plan`/`db migrate` also require a fixed build, since they open a writable connection (including internal migrations) to a file a dev process may own. Generate/check use scratch databases. These guards do not police external SQL tools; avoid concurrent external writers/checkpointers on vulnerable SQLite. `VACUUM INTO` backups and manual `db.$client.exec("PRAGMA wal_checkpoint(TRUNCATE)")` remain supported; a held reader can postpone checkpoint completion.
- Migrations live in `<pebble>/migrations/*.sql`. The files are the baseline: there is no `meta/` journal or snapshot (an old `migrations/meta/` is ignored and can be deleted). The runner applies every unapplied `*.sql` in name order, tracked by name and SHA-256 in `_bedrock_migrations`, including a file that sorts before one already applied.
- `bedrock db generate [name] [--allow-data-loss]` replays every migration into an in-memory SQLite database with the runner's own code (foreign keys on, same validation), then diffs it with the Drizzle tables in `pebble.schema` using `pushSQLiteSchema` from `drizzle-kit/api` (the drizzle-kit installed beside `bedrock` when there is one, else the pebble's; `DRIZZLE_KIT_MISSING` otherwise). drizzle-kit's spinner and prompts are suppressed. No difference: nothing is written. Otherwise it writes `migrations/<UTC YYYYMMDDHHMMSS>_<slug>.sql` (slug from `name`, reduced to `[a-z0-9_]`, default `schema`), stamped one second after the newest timestamped file if the clock is not later. Legacy `0000_*` names sort first. Before writing, the new SQL must pass migration validation, replay after the existing files, and leave an empty diff (`GENERATE_FAILED` otherwise).
- Generate refuses with `MIGRATION_DATA_LOSS` when the SQL drops columns, unless `--allow-data-loss`; a NOT NULL column added to an existing table without a SQL default fails with `MIGRATION_NOT_NULL` (SQLite rejects it once the table has rows, and push would wipe the table). A table that both loses and gains columns fails with `MIGRATION_AMBIGUOUS`, because a rename and a drop plus add look alike. Tables and views the migrations create but `pebble.schema` does not declare are reported as `unmanagedTables` and never diffed, so generate never drops a table; drop it by hand.
- `bedrock db new <name>` writes an empty timestamped file with a one-line SQL comment, for renames, backfills and drops.
- `bedrock db check` replays and diffs the same way. It fails with `MIGRATION_REPLAY_FAILED` naming the file when a migration no longer applies (two merged branches that added the same column), and with `SCHEMA_DRIFT` when the schema changed without a migration. `bedrock dev` runs it at startup and prints these as warnings on stderr.
- Table rebuilds (`__new_<table>`, copy, drop, rename) are generated for changes SQLite cannot `ALTER`. When other tables reference the rebuilt one, the file contains `PRAGMA foreign_keys=OFF` … `ON`. Because that pragma is a no-op inside a transaction, the runner turns foreign keys off before the transaction of any migration containing `PRAGMA foreign_keys=OFF`, runs `PRAGMA foreign_key_check` before commit (`MIGRATION_FOREIGN_KEY`, rolled back, on violations), and turns them back on. Without this, dropping the old table would cascade deletes. The copy names only columns the old table has, so a column added in the same rebuild gets its default (drizzle-kit would copy the column's name as a string literal). Rebuilds drop the table's triggers.
- Migrations are applied in order on deploy and on `bedrock dev` start. A failed migration aborts the deploy and leaves the previous version running.
- `bedrock db plan` prints pending SQL without applying it; `bedrock db migrate` applies it to `.bedrock/db.sqlite`. `bedrock db shell <pebble>` opens a SQL REPL.
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
- A signed-in account refused by the pebble's access policy gets, for HTML page requests, a 403 page naming the account with a "Sign out and switch account" form that posts to `/_bedrock/sign-out` (same Origin rule as `/_bedrock/logout`; it revokes the session and redirects 303 to `/`). Other requests get 403 `FORBIDDEN`.
- Google sign-in always asks Google for its account picker (`prompt=select_account`) so a browser signed in to Google can choose a different account.
- A localhost daemon may use dev email authentication while accepting deployments.
  Deployed releases retain data under the daemon home across redeploy/restart;
  only an explicitly attached dev source uses its source-local `.bedrock` directory.
- **Dev mode** (`bedrock dev`): no Google. A local login page lets you pick any email. Agents must be able to test auth flows without credentials.

### Public HTTP routes

`publicRoute(handler)` from `bedrock` marks an individual registered HTTP route
as public on any access mode, including `creators`, `users`, and allow lists.
It accepts a plain Bun handler or `detached(handler)`; on a public pebble it is
allowed and redundant. Only entries in `routes` qualify: sockets, functions,
storage, jobs, services and reserved `/_bedrock` endpoints cannot be marked
public. Invalid placements or public wildcard keys throw `BedrockError` at
configuration/load time. Public route keys must use normalized paths without
repeated slashes or dot segments.

The child health response carries exact registered `public_routes` keys alongside
`access`; the supervisor validates them before activating the release. Deploy
output and `bedrock ls` (human and JSON) show this list. JSON uses
`public_routes: string[]`; a release metadata file retains the list while stopped.

The daemon matches the WHATWG-normalized `url.pathname` that it proxies, case
sensitively, segment by segment. Methods must match exactly, except HEAD may use
GET because Bun serves that fallback. A `:param` consumes exactly one nonempty
segment. Static segments compare literally, without percent decoding; trailing
slashes, extra/empty segments, case changes and encoded static spellings do not
broaden exposure. WHATWG dot-segment normalization happens before matching.
Normal private routes may use Bun wildcards, but public keys containing `*` are
rejected rather than extending the matcher with wildcard semantics. Reserved
`/_bedrock` paths never qualify, even through a parameter pattern. On protected
pebbles with a Bun HTML entry, root parameter public GET/HEAD routes (`/:id`) are
rejected at load: generated bundle assets outrank them and bypass custom-handler
checks. Use a namespaced pattern, a static public route, or a static web directory.
Explicit static HTTP handlers override generated assets; namespaced parameter
routes do not overlap Bun's root asset routes.

Matched HTTP requests are always anonymous, even with valid credentials: the
daemon skips session resolution, access enforcement, Origin checks and HTML
login redirects, strips **all Cookie, Authorization and x-bedrock-* headers**,
and attaches no signed identity. There is no ambient identity to borrow for
CSRF or replay. `ctx.user` and `ctx.token` are null, including detached read/write
callbacks. WebSocket upgrades never qualify.

The child rechecks the handler Bun actually dispatches: normal routes enforce
pebble access for anonymous, signed and token identities; public handlers strip
credentials again and execute anonymously. Thus a private static route overriding
a public parameter route (or a private HEAD overriding public GET) returns
401 `UNAUTHENTICATED` for an anonymous request admitted by the daemon. Internal
health/control routes keep their existing behavior; functions, storage and
sockets retain their own access checks. Private HTML requests still redirect at
the daemon as before, except requests rejected by the child recheck return 401.

### Pebble tokens

Opt in with `definePebble({ tokens: true, ... })`. Pebble tokens are per-user,
per-pebble credentials for native and scripted clients, separate from creator
deploy tokens. The pebble DB owns reserved `_bedrock_tokens(id, hash, user_id,
user_json, name, permissions, created_at, last_used_at, expires_at, revoked_at,
metadata)`, created through the same internal startup migration mechanism as
`_bedrock_files`; older tables gain the nullable `metadata` column on startup.
Backups and restores include it. Tokens are `brk_` plus 32 random bytes encoded as
base64url; only their SHA-256 hash is stored. Creation returns the raw token once.

`ctx.tokens.create({ name, permissions, expiresAt?, metadata? })` requires a user
and a mutation slot, returns `{ id, token, name, permissions, effective, profiles,
metadata, createdAt, expiresAt }`, and refuses token-authenticated callers.
`metadata` is an optional object of at most 32 string values whose JSON is at most
4 KB; anything else throws `INVALID_TOKEN_METADATA`. Absent metadata reads as `{}`.
`ctx.tokens.list()` returns the current user's non-revoked tokens (`id, name,
permissions, effective, profiles, unknownProfiles, metadata, createdAt,
lastUsedAt, expiresAt`). `ctx.tokens.revoke(id)` requires a mutation slot, only permits owned
tokens, and is idempotent. Creation/revocation participate in the caller's
transaction. Disabled methods throw `TOKENS_DISABLED`. Timestamps are Unix
milliseconds; absent expiry and unused timestamps are null.

`ctx.token` is `{ id, name, permissions, effective, profiles, metadata }` for token
authentication, otherwise null. `permissions` are the stored grants; `effective`
is what the request is authorized against (see profiles below). Detached contexts also expose it, and read/write callbacks retain it.
Jobs always have `token: null`. A valid signed daemon identity wins over bearer
authentication. Otherwise enabled pebbles resolve `Authorization: Bearer brk_…`
from the stored user snapshot; unknown, revoked, or expired credentials yield
JSON 401 `UNAUTHENTICATED`. Current pebble access policies still apply, including
allow lists and `BEDROCK_CREATORS`, on functions, routes, storage, and WS.

Permissions default to deny, and creation validates registered targets:

- `*`: everything the user could do, including WS sync.
- `query:<name>` / `mutation:<name>`: that HTTP function.
- `route:<METHOD> <path-pattern>`: the exact registered route key, including
  detached and public routes. Public routes need no token or permission; credentials
  are discarded rather than used to authorize them.
- `socket:<path>`: the registered application socket path.
- `files:<bucket>:upload|read|delete`: built-in storage endpoints; all chunk
  operations, including status, require upload.
- `profile:<name>`: every entry of a profile configured by the running pebble.

Profiles name permission sets in the pebble config instead of copying them into
each token:

```ts
definePebble({ tokens: { profiles: {
  sync: ["query:changes", "mutation:push", "files:attachments:upload"],
  "read-only": ["query:changes"],
} }, ... });
```

`tokens: true` is the same as `tokens: {}`. Profile names match
`^[a-z][a-z0-9-]{0,47}$`; entries use the explicit forms above, so `*` and
`profile:` are rejected. Unknown targets or invalid names fail pebble load with
`INVALID_TOKEN_PROFILE`, naming the profile and entry. A token may mix profiles
and explicit grants. Profiles expand on every request from the running config, so
an operation added to a profile reaches existing tokens on the next deploy without
re-minting. `ctx.tokens.create` accepts `profile:<name>` only for a configured
profile. A stored profile the running config no longer defines grants nothing,
does not fail authentication, and is listed in `unknownProfiles`. `profiles` lists
the token's profiles that do exist; `effective` is the de-duplicated expansion.

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
6. Clients reconnect with exponential backoff and resubscribe automatically. Mutations over WS return `{ op: "result", id, ok, value | status, error }` (see [Errors](#errors)).

Without `sync`, the same queries/mutations are callable over plain HTTP:
`POST /_bedrock/q/<name>` and `POST /_bedrock/m/<name>`.

### Idempotency

A mutation can commit while its response is lost. An idempotency key makes the
retry safe: the first committed result is stored and replayed.

- **Transport.** HTTP sends header `Idempotency-Key: <key>` on
  `POST /_bedrock/m/<name>`; WebSocket sends
  `{ op: "mut", id, mutation, args, idempotencyKey }`. A key is 1–255 visible
  ASCII characters (0x21–0x7E); anything else, including an empty header, fails
  with `INVALID_IDEMPOTENCY_KEY` (400). Queries ignore the header.
- **Args key source.** `mutation({ args: schema, idempotencyKey: args => args.requestId, run })`
  derives a key from the validated args. `null`/`undefined` means no key; any other
  non-string or invalid result fails with `INVALID_IDEMPOTENCY_KEY`. A transport key wins
  over the args key.
- **Scope.** Keys are per mutation name and per caller: `token:<id>` for pebble-token
  requests, else `user:<id>`, else `anon` (all anonymous callers share one scope).
- **Replay.** Inside the mutation's `BEGIN IMMEDIATE` slot, an unexpired key with the same
  args (sha256 of key-sorted JSON of the validated args) returns the stored value without
  running the handler. The replay writes nothing, so nothing is invalidated and no
  subscription re-runs. The same key with different args fails with
  `IDEMPOTENCY_KEY_REUSED` (409).
- **Storage.** After a successful run the result is stored in the internal table
  `_bedrock_idempotency` before `COMMIT`, so result and key commit atomically. Failed
  mutations store nothing; a retry runs the handler again.
- **Window.** Keys expire after 24 h and never match afterwards. Expired rows are purged
  lazily inside mutation slots, at most once per 10 minutes.
- **Client.** Every `client.mutate()` call generates a `crypto.randomUUID()` key and keeps it
  for all attempts. Over WS, a sent mutation whose socket closes (`CONNECTION_LOST`) or
  that gets no result within 30 s (`MUTATION_TIMEOUT`) is resent with the same key after
  reconnecting (or over the HTTP fallback), up to 3 attempts in total; then the last error
  surfaces. HTTP mutations retry the same way, with a 250 ms × attempt pause, only when no
  response arrived; an error response is never retried. A new `mutate()` call is a new key.

### Seamless

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
reconnect now with `attempt = 0`. Sent mutations pending at `pagehide` count one
failed attempt and are resent with the same idempotency key after `pageshow`
(see [Idempotency](#idempotency)).

**Static caching (static `web` directories and deployed HTML builds).**
- `.html` responses: `Cache-Control: no-cache`.
- Fingerprinted assets (a `-` or `.` followed by 8+ `[A-Za-z0-9_-]` chars containing a
  digit, right before the extension): `Cache-Control: public, max-age=31536000, immutable`.
- Everything else: `Cache-Control: no-cache`. All files get a weak `ETag` from size and
  mtime and answer `If-None-Match` with 304.
- A fingerprinted asset missing from the current release is served from the previous
  release's same web directory if present (the supervisor passes
  `BEDROCK_PREVIOUS_RELEASE`), so tabs still on old code keep loading lazy chunks.
  HTML is never served from the previous release.
- Deploy-time HTML builds use content-hashed asset names, immutable caching and
  the same weak validators. Missing hashed assets can come from the previous
  release's build; HTML always comes from the selected release. Explicit custom
  routes keep precedence; other URLs fall back to the built HTML entry.
- Development HTML-bundle mode keeps Bun's own asset handling.

**Bun HTML bundles and React.** Bedrock runs every pebble process with
`bun --config=<bedrock>/src/runtime/bunfig.toml`, whose `[serve.static] plugins`
loads `bedrock/bundler`. The plugin resolves every `react` and `react-dom` import
(including subpaths such as `react/jsx-runtime` and `react-dom/client`, but not
`react-dom/server*`/`static*`) from the pebble directory, so linked Bedrock
packages, `@bedrock/ui` and its dependencies share the pebble's single React copy
in `bedrock dev` and in the deploy-time browser build. Without it they would resolve React from
their real path in the Bedrock checkout and the page would render blank
(`Cannot read properties of null (reading 'useContext')`). A pebble without
React falls back to normal resolution. A pebble's own `bunfig.toml` replaces
Bedrock's (Bun reads one config), so it must list the plugin itself:
`[serve.static] plugins = ["bedrock/bundler", …]`; `bedrock doctor` warns otherwise.

**Production builds and private source maps.** After installing a release's
production dependencies, the daemon builds its HTML `web` entry once with
`Bun.build`: browser target, production React, minification, split/content-hashed
assets, absolute asset URLs and external source maps. It uses the same
`serve.static.plugins` as development (Bedrock's single-React plugin by default;
a pebble's own `bunfig.toml` replaces that list). Build plugins and browser
imports must be production dependencies. No laptop build step or new author
option is required. The build runs in a separate Bun process, with the child's
allow-listed host environment and pebble secrets; build errors redact those
secrets. One build runs at a time across deploys, with a 120-second deadline.
It imports `pebble.ts` to discover `web`, so keep module-scope work free of side
effects, as for other configuration-loading commands.

Each release owns `.bedrock-web/public/`, `.bedrock-web/maps/` and an internal
manifest. Only `public/` is served. External maps contain original sources;
the private map directory is owner-only on POSIX. Requests for `.map` paths or
any `.bedrock-web` path return 404; generated JS has no `sourceMappingURL`.
Static `web` directories are already built: Bedrock snapshots their regular files,
preserves URLs, moves supplied maps into private storage and strips JS/CSS map
comments (including inline maps, which are retained privately). It does not
recompile these assets or invent original-source mappings for files shipped
without maps. Local map-comment targets are associated with their bundle;
external URLs are never fetched.

Build failure (`WEB_BUILD_FAILED`, with a repair hint) aborts before migrations,
services or the health gate and leaves the previous release serving. The
three retained releases include their matching public assets and private maps;
rollback/restart reuse them without rebuilding. Existing releases without the
manifest retain their old serving path until redeployed. `bedrock dev` and
`bedrock test` keep live HTML bundling/HMR and ignore production artifacts.

For later error tracking, internal `daemon/source-maps.ts` exports
`symbolicate(releasesDirectory, releaseId, bundlePath, line, column)`.
The caller supplies the trusted pebble releases directory, an exact release id,
an absolute bundle pathname (no origin/query), and **one-based** line/column.
It returns `{ source, line, column, function }`, where `function` is the mapped
name or null; unmapped positions, absent maps and pruned releases return null.
Malformed maps raise `SOURCE_MAP_INVALID`; invalid coordinates/paths raise
`INVALID_SOURCE_POSITION`. Lookup uses only the exact private manifest, never
an event-provided URL. Server-side Bun TS stacks already identify original TS
lines; no server compilation/map layer is added.

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

- Files live in `<data root>/pebbles/<name>/data/files/<bucket>/<id>`; metadata in the pebble DB table `_bedrock_files(id, bucket, owner_id, name, mime, size, sha256, created_at)`.
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
  config.json        { domain, creators: [emails], port, dataDir?, cloudflare: local or remote tunnel metadata, google: {...} }
  setup.json         versioned checklist with completion timestamps and deferred steps
  cloudflared/       local mode: cert.pem, credentials.json (0600), config.yml
  backup-credentials R2 access key/secret (0600); config.json stores only target metadata
  backup-state.json  last successful full/per-pebble backup times
  tunnel-token       Cloudflare tunnel run token (0600); API token is never persisted
  logs/cloudflared.log  rotated cloudflared output (run token redacted)
  bedrock.sqlite     users, sessions, pebbles registry (release paths relative to home), deploy tokens
  observability.sqlite  daemon telemetry; disposable, excluded from backups
  alerts.sqlite         durable incidents, job deadlines/history and webhook outbox
  alerts-secret         webhook bearer credential (0600; never sent to children)
  errors.sqlite         error payloads/counts/state; disposable, excluded from backups
  pebbles/<name>/
    releases/<ts>/   deployed code + .bedrock-web/{public,maps,manifest.json} (last 3)
    current -> releases/<ts>  (relative link; absolute directory junction on Windows)
    secrets.json    private environment secrets, outside releases and data (0600 / owner ACL)

<data root> = config.dataDir, or $BEDROCK_HOME when unset
  pebbles/<name>/
    data/db.sqlite, data/files/   BEDROCK_DATA / ctx.dataDir
    logs/            legacy rotated stdout/stderr only; new lines go to observability.sqlite
```

- **Data directory.** `dataDir` (absolute) moves every pebble's `data/` and `logs/`
  to another disk; new telemetry stays in BEDROCK_HOME. Code, secrets, daemon databases, configuration and
  `cloudflared/` stay in `$BEDROCK_HOME`. Unset, the layout is unchanged. When
  `dataDir` is set the daemon refuses to start (`DATA_DIR_MISSING`) unless
  `<dataDir>/pebbles` exists, so an unmounted disk never gets fresh, empty
  pebble data. Set it on a fresh install with `bedrock setup identity --data-dir
  <path>` (setup refuses with `DATA_DIR_IN_USE` once pebble data exists). Doctor
  reports the data directory and its free space (`data-dir` check).
- `bedrock data move <dir>` relocates existing data while the daemon is stopped
  (`DAEMON_RUNNING` otherwise). For each `pebbles/<name>/{data,logs}` in the
  current data root it copies into `<dir>/pebbles/<name>/<category>.partial`
  (files, modes, mtimes, symlinks verbatim; sockets and FIFOs skipped), compares
  SHA-256 of every file, symlink target and directory against the source
  (`DATA_COPY_MISMATCH`), then renames it into place. Only after every copy
  verifies does it write `dataDir` (`<dir>` equal to home removes the key). The
  old copy is never deleted: remove it after checking the pebbles, or revert by
  restoring the previous `dataDir`. It refuses overlapping directories
  (`INVALID_DATA_DIR`), too little free space (`DATA_DIR_FULL`) and an existing
  target that differs from the source (`DATA_DIR_NOT_EMPTY`); an identical
  target from an interrupted run is accepted, so the command can simply be rerun.
- Paths Bedrock persists are relative to their root so `$BEDROCK_HOME` can
  move: registry releases (older absolute rows ending in
  `pebbles/<name>/releases/<id>` are rewritten when the daemon opens its
  database), `current`, and the local tunnel's `credentialsFile`/`configFile` in
  `config.json`. `cloudflared/config.yml` holds an absolute `credentials-file`
  because cloudflared requires it; rerun `bedrock setup cloudflare` after moving
  home. Release `node_modules` links to first-party packages point at the
  daemon's checkout (`$BEDROCK_HOME/src` for installer setups): keep the checkout
  at the same path, or redeploy, when moving home.

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
  no host configuration. Source installs write `"bedrock": "link:bedrock"` and
  `"@bedrock/ui": "link:@bedrock/ui"`; `install.sh`/`install.ps1` and
  `self-update` register both packages with `bun link`; `new` registers any that
  are missing (it never re-points an existing link). The lockfile stores
  `bedrock@link:bedrock` with no path, so copies and git worktrees of a pebble
  just work with `bun install --frozen-lockfile`, and local dev runs the
  daemon checkout's code. Deployment substitutes the daemon's own first-party
  packages whatever the specifier. The release installs its own React; the
  daemon's copies of first-party peers (`react`, `react-dom`, `drizzle-kit`) are
  linked in only when the release does not install them.
- `new`, `init`, `db`, `deploy`, `rm`, `start`, `stop`, `restart`, `rollback`,
  `secrets`, `token`, `pebble-token`, `session`, `backup`, and `jobs` accept `--help` or `-h`: print command
  usage and a description, exit 0, and perform no actions. With `--json`, help
  is `{ ok: true, command, usage, description }`. Unknown flags to `new`/`init`
  fail with `INVALID_ARGS` and a usage hint. Invalid pebble names fail with
  `INVALID_PEBBLE_NAME`; names must start and end with a lowercase letter or digit.
- The creator dashboard at `bedrock.<domain>/` uses Google session authorization;
  it redirects to sign-in and lists pebble links for creators only. A signed-in
  non-creator gets a 403 page naming the account with a sign-out form (`POST /sign-out`);
  so does CLI sign-in (`/cli-login`). CLI status
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
- Crash recovery retries indefinitely. The first four failures use exponential
  backoff (`250 ms * 2^failures`, capped at 30 s), with 0–10% downward jitter.
  From the fifth failure, status is `crashed` and retries continue every 4.5–5
  minutes; successful health checks restore `running`. A run of at least ten
  minutes (twice the retry cap) resets the failure streak. Start/deploy/rollback
  replacements reset it too. Stop, deletion and shutdown cancel pending retries;
  replacement activation supersedes them. At boot, `running`, `restarting` and
  `crashed` pebbles are restored, and failed restoration keeps retrying.
  `/api/status` and `/api/pebbles` include `next_retry_at` (Unix milliseconds,
  or null when no retry timer is pending), also available through CLI JSON.
- On Linux, child `oom_score_adj` is raised to the daemon's value plus 500,
  capped at 1000, so the kernel prefers a pebble over the daemon under memory
  pressure. This is best effort on restricted procfs; macOS/Windows skip it.
- **Idle pebbles scale to zero by default.** After 15 minutes without proxied
  HTTP activity, open WebSockets (anonymous, bearer, session, sync or application),
  or child IPC work, an eligible production child is gracefully stopped and its
  persisted status becomes `idle`. The daemon sweeps once a minute, so sleep can
  take up to one extra minute. HTTP activity lasts through request uploads and the
  full response stream; the quiet period starts again when work finishes.
  `idle` is distinct from user-selected `stopped`, `restarting` and `crashed` in
  CLI status, the API and dashboard. Its PID/port are null and `healthy` is false
  because there is no child to probe; doctor treats idle as healthy operation.
  Development daemons and `bedrock dev` never idle-stop.
- The next HTTP request, WebSocket upgrade or daemon IPC operation that needs
  the child wakes an idle pebble using the existing health-gated launch. Concurrent
  arrivals share one launch and wait for it, including while the old child is
  finishing its graceful shutdown. Failed wakes return the usual styled/plain
  503 with `Retry-After: 5` to proxy callers and enter normal crash supervision.
  Explicit stop still requires explicit start; traffic never starts a stopped
  or crashed pebble. Deploy, rollback, restart and secrets `--restart` health-gate
  a replacement even from idle, and that replacement may later sleep again.
  Daemon restart preserves idle pebbles asleep; running/restarting pebbles still
  start at boot. Data moves preserve the registry state. Backups read SQLite
  directly and use release backup metadata, so do not wake sleeping pebbles.
- **Sleep safety is conservative.** Any declared job or service (including an
  exclusive service) keeps a pebble awake. Immediately before sleep the daemon
  asks the child over IPC to check pending HTTP requests, WebSockets, queued and
  detached execution, and unexpired resumable uploads (24-hour expiry). Failure
  or timeout keeps the child awake. Health info supplies job/service names and
  access policy; `.bedrock-idle.json` beside the release persists these and its
  source eligibility, alongside public-route and backup metadata.
  Bun currently omits live timers from resource/handle introspection. Therefore
  eligibility also requires a conservative scan of `pebble.ts` and its static
  local imports: unknown imports, dynamic imports, timers, outbound fetch/sockets,
  workers, process/global access, dynamic execution and Bun APIs other than
  `Bun.file` keep it awake, even when only used inside a request handler or comment.
  Only `bedrock` and `node:path`/`path` imports are trusted without scanning;
  unresolvable imports and non-JavaScript imports keep it awake too. Custom
  Bun configuration (other than the standard static bundler plugin), inherited
  TypeScript configuration, import aliases and unreadable configurations also
  keep it awake, so preloads/plugins cannot silently introduce background work. This is a
  heuristic for trusted source, not a sandbox or proof against computed/obfuscated
  access to runtime APIs. No new author option is added. In-memory caches/state
  may be lost; persist durable state in SQLite/files and declare autonomous work
  as a job or service rather than hiding loops at module scope.
- **Quiet running pebbles hibernate in place on supported Linux hosts.** The
  production daemon detects a writable, delegated cgroup v2 memory controller
  at startup; missing support (including development mode) logs one disable line
  and leaves supervision unchanged. Each child launch gets a separate cgroup,
  including overlapping deploy candidates. A tiny shell joins that cgroup before
  execing Bun, so runtime/module allocations are charged there from startup.
  The daemon and cloudflared stay in a `supervisor` leaf; older running units move
  processes out of the delegation root before enabling `+memory`. Empty stale
  child cgroups are removed at boot and child exit. No io controller is needed.
- After 15 quiet minutes (the same conservative delay as idle sleep), the daemon
  first attempts eligible idle stops, then reclaims anonymous memory of remaining
  running children. Requests, full HTTP streams, open WebSockets and pending IPC
  prevent reclaim. Jobs/services/timers keep running and live state survives;
  pages fault back on demand. Reclaim runs once per child per quiet period and
  only proxied activity re-arms it, so jobs pulling pages back cannot cause churn.
  First requests after a long quiet period may take tens of milliseconds.
- Reclaim writes the child's `memory.stat` anonymous byte count with
  `swappiness=200` to `memory.reclaim`: file pages (including SQLite's page cache)
  are never targeted. EAGAIN/partial reclaim is normal. The host must have free
  swap for the uncompressed anonymous bytes plus `max(256 MiB, 25% of those
  bytes)` reserved for other users. There is no fallback to file-page reclaim.
  A short-lived Worker performs the blocking write, one child at a time, keeping
  the daemon event loop free. Failures are best effort and leave the child running.
- Each child has `memory.high = max(1 GiB, 25% of physical RAM)`, a generous
  runaway throttle well above ordinary small pebble usage; `memory.max` is never
  set. This is resource management for trusted processes, not isolation.
  `/api/pebbles`, `/api/status` and `bedrock status --json` include a per-pebble
  `memory: { resident, swapped, hibernated_at }`. Resident is cgroup
  `memory.current` in bytes (including charged cache/kernel memory, not process
  RSS); swapped is `memory.swap.current` in bytes. `hibernated_at` is the Unix
  millisecond time of the completed reclaim attempt, cleared by proxied activity.
  A partial reclaim still counts. All three are null without a supported live
  child cgroup. Hibernation keeps status `running`; it adds no author option.
- Reserved subdomains: `auth`, `bedrock` (daemon API/dashboard), `www`.
- A deployed pebble that is not running (stopped, crashed, restarting) answers 503
  with `Retry-After: 5` and a `bedrock start <name>` hint; 404 means no such pebble.
- Daemon-owned responses (auth, dashboard, CLI sign-in, sign-out, 404/503 and other
  daemon errors) render as styled HTML pages that follow the system light/dark
  setting when the request's `Accept` includes `text/html` and the path is not
  under `/api/`. Every other request gets JSON `{ ok: false, error }` (404/503
  stay plain text). Errors from pebble code are unaffected. The local CLI login
  callback also answers with a styled page.
- **Deploy**: `bedrock deploy` in a pebble directory. Local: copies to a new release. Remote: tars the directory and uploads to `https://bedrock.<domain>/api/deploy` with a creator deploy token (`bedrock login` stores it). Daemon then installs deps (`bun install --production`), prepares the production browser build and private maps, starts/migrates the candidate, health-checks, then swaps.
  Archives always omit `node_modules`, `.bedrock`, `.git`, `._*`, `.DS_Store`,
  `.env` and `.env.*` at every depth, and the archive output itself. `.envoy/`
  and `.environment` are included. Git ignore rules are never applied: ignored
  web/build output is deployed too. Deploy a clean export with `bedrock deploy
  <dir>` to ship less; scratch trees are otherwise included.
  Releases record `provenance: { commit, branch, dirty }` from the deployed
  directory's Git state, including untracked files. Missing Git/non-repositories
  yield null fields and do not block deployment. Detached HEAD has a null branch.
  Provenance is retained with each release across daemon restarts and rollback;
  deploy, lifecycle, list and status responses describe the selected release.
  Older releases/clients without provenance report unknown source (null fields).
  Dirty deploys warn without blocking. Compressed archives over 50 MB (decimal)
  warn with the five largest included top-level directories and their uncompressed
  file sizes; sizing reads metadata only, skips excluded paths and follows no links.
  Human deploy output prints warnings; `--json` keeps one stdout value with a
  `warnings: string[]` field. Older daemons accept deployment but cannot retain
  provenance sent by newer CLIs.

- `bedrock service install|uninstall|status` manages a macOS **LaunchAgent**
  (`~/Library/LaunchAgents/dev.bedrock.daemon.plist`, RunAtLoad/KeepAlive) or Linux
  **systemd user** unit (`~/.config/systemd/user/bedrock.service`, Restart=always, OOMPolicy=continue,
  Delegate=yes, DelegateSubgroup=supervisor).
  A pebble OOM kill therefore leaves the daemon and other pebbles serving.
  Install writes the current unit; Linux daemon CLI startup and local/remote
  self-update refresh an existing matching-home unit's OOM and delegation settings idempotently
  and run `systemctl --user daemon-reload` when it changes. `DelegateSubgroup`
  is supported by systemd 257; startup also handles a populated delegation root
  on managers that ignore it.
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
  servers. On the server, login reports that it uses the local admin token and
  gives `pebble-token create --as` / `session create --as` commands for an existing
  creator. It also explains that browser login must run on the computer with the
  browser, because the callback is loopback-only.
- CLI credentials are `{url, token}` in `~/.config/bedrock/credentials.json`
  (or `$XDG_CONFIG_HOME/bedrock/credentials.json`), mode 0600. Explicit URL/token
  flags override environment variables; the reachable local daemon takes priority
  over saved remote credentials. An explicit URL can use a saved token only for
  its matching origin. Tokens are never forwarded through HTTP redirects.
- `bedrock logout` revokes the saved token remotely before deleting credentials;
  offline failure retains credentials for retry. `bedrock token create|ls|revoke <id>`
  manages hashed deploy tokens; ls returns IDs, names, creation times, owner user IDs and scope, never raw tokens.
  Unscoped creator deploy tokens grant full daemon operations, including token management.
- `bedrock doctor` checks Bun, local daemon/configuration, domain/creators, OAuth,
  cloudflared installation/process, tunnel ingress/DNS via the API when a transient
  API token is available, wildcard resolution via Cloudflare DoH, available disk,
  each pebble's live health (idle and intentionally stopped pebbles pass), and backup age (warn when > 2× interval). From a
  source checkout it warns when `bedrock` or `@bedrock/ui` is not `bun link`ed
  to that checkout (`link:<name>`); run in a pebble directory, it warns when the
  pebble still uses `file:` dependencies (`pebble-deps`, hint: the `bun add
  …@link:…` fix) or `node_modules/<name>` does not resolve to the checkout
  (`pebble-link:<name>`), or when the pebble's own `bunfig.toml` does not list
  `bedrock/bundler` in `[serve.static] plugins` (`pebble-bunfig`). Offline DNS and unavailable API credentials are
  skipped warnings; any failed check sets exit code 1. `doctor --json` emits an
  array of checks `{name, status: pass|warn|fail, message, hint, skipped?}`.

### Child control channel

The daemon controls pebble children over parent/child IPC, separately from HTTP
identity forwarding. Requests are `{ op, requestId, ...payload }`: `jobs.list`,
`jobs.run` (payload `{ name }`), `service-token` (payload `{ user, input?, id? }`),
`readiness` (no payload; returns `{ state }`), `idle.check` (no payload; returns a boolean), and `services.exclusive.start` (no payload; returns `{ started: string[] }`).
Replies are `{ op: "reply", requestId, value }` or
`{ op: "reply", requestId, error: { code, message, hint } }`. The daemon sends
`{ op: "stop" }` without a reply; the child performs cleanup and exits. Startup
also reports the stop budget and readiness over IPC. Pending requests reject
with `PEBBLE_STOPPED` when the child exits. Unknown `/_bedrock/*` HTTP paths return
the JSON 404; there is no HTTP jobs control endpoint or special daemon user identity.

Child health includes `exclusive_services: string[]` (declared exclusive service
names, including before they start); malformed lists fail launch with
`HEALTH_FAILED`. The supervisor starts these services only after activation and
all retiring children of the pebble have exited: deploy, rollback, restart,
initial/daemon restore, crash restart and attached dev launch. The exit barrier
survives a replacement crashing while its predecessor drains. The IPC request
has a 60-second deadline (`EXCLUSIVE_START_TIMEOUT`); a timeout kills the child
so normal crash handling applies. Other startup failures are logged and the
child replies with the error, gracefully stops, and exits with code 1.

### Pebble secrets and delegated administration

The daemon provides these bearer-authenticated endpoints. All successful daemon
API responses use `{ ok: true, value }`; the shapes below describe `value`. Errors
use `{ ok: false, error: { code, message, hint } }`. Secrets and service-token
responses retain `Cache-Control: no-store`. CLI JSON retains its existing envelopes.

- `GET /api/pebbles/:name/secrets` → `{ secrets: [{ name, updatedAt }] }`, sorted
  by name. Never returns values. Works before a pebble is deployed; an absent
  file returns an empty list.
- `PUT /api/pebbles/:name/secrets` accepts `{ set?: Record<string,string>,
  unset?: string[], restart?: boolean }` and returns the same metadata shape
  (plus `exclusive_services` when `restart: true`).
  All input is validated before writing; set is applied before unset. Secret
  names match `^[A-Z][A-Z0-9_]{0,63}$`; values are exact strings without NUL.
  `BEDROCK_*`, `BUN_*`, `NODE_*`, `LD_*`, `DYLD_*` and operating-system environment
  controls are reserved. The exact additional reserved names are `PATH`, `HOME`,
  `USER`, `SHELL`, `TMPDIR`, `TMP`, `TEMP`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`,
  `PATHEXT`, `ENV`, `BASH_ENV`, `IFS`, `CDPATH`, `SHELLOPTS`, `APPDATA`,
  `LOCALAPPDATA`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `SYSTEMDRIVE`.

Secrets live at `$BEDROCK_HOME/pebbles/<name>/secrets.json`, mapping names to
`{ value, updatedAt }` (Unix milliseconds). Writes use a private atomic temporary
file and rename. POSIX permissions are 0600; Windows uses the shared private-file
owner/SYSTEM ACL helper before publication. Reads also enforce private-file
permissions. This file is outside releases and data, so deploy, rollback and
restore preserve it. Database and configured-directory backups exclude it, like
backup/Cloudflare credentials; back it up separately as a credential file.
Deleting a deployed pebble removes it along with the pebble directory.

Deployed children inherit only an allow-listed daemon environment, matched
case-insensitively: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`,
`TZ`, `TERM`, `TMPDIR`, `TMP`, `TEMP`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`,
`SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`, `BUN_INSTALL`, `SYSTEMROOT`,
`WINDIR`, `COMSPEC`, `PATHEXT`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `HOMEDRIVE`,
`HOMEPATH`, `SYSTEMDRIVE`, `PROGRAMDATA`, `PROGRAMFILES`, `PROGRAMFILES(X86)`,
`COMMONPROGRAMFILES`, `NUMBER_OF_PROCESSORS`, `PROCESSOR_ARCHITECTURE`, `OS`,
`PSMODULEPATH`, and all names beginning `LC_`. Original key spelling is retained;
undefined values are omitted. Attached dev sources (`bedrock dev`) instead inherit
the developer's full shell environment. Every launch overlays current pebble
secrets, then reserved Bedrock values. Pebble credentials must come through
`bedrock secrets`, never the daemon or service environment. This covers deploy swaps,
restart, rollback, daemon restoration and crash recovery. Children also receive
`BEDROCK_API_URL=http://127.0.0.1:<actual-daemon-port>`; loopback `/api/` requests
reach the authenticated daemon API without a Host override. This URL conveys no
credentials; a pebble must explicitly supply its own deploy bearer.
### Error tracking

Error capture is **on by default, minimal by default**. Browser `createClient()`
adds `error` and `unhandledrejection` listeners, removed by `client.close()`.
Resource-load failures without an exception/message are skipped. Node and bearer
clients do not install browser listeners; cross-origin clients do not report the
host page to another pebble. The page release comes from existing navigation
Server-Timing / release headers, so a stale tab uses its own release's maps.

`createClient({ errors: false })` disables capture. Opt in to console errors or
Bedrock HTTP 5xx capture with `errors: { console: true, fetch: true }`; this does
not patch global fetch. `errors.beforeSend(event)` can return a filtered event or
null; its output is allowlisted and scrubbed again. `client.captureException(e)`
is explicit opt-in capture. `bedrock/react` exports an optional `ErrorBoundary`
with `{ client, fallback, children }`; wrapping a subtree opts in to handled
React errors. No automatic component/DOM context or web-vitals instrumentation
is installed. Vitals remain a pebble-level opt-in integration, not an error
payload. The tiny native protocol is not Sentry-compatible.

The client caps capture at **20 events per fixed UTC minute**, a 20-event memory
queue, at most five events per batch, and a two-second timer. It deduplicates
Error objects per client and global events across clients. Hidden/pagehide flush
uses sendBeacon with keepalive fetch fallback. Normal sends use same-origin
cookies for admission, no bearer/custom headers, and a five-second timeout.
429 pauses until Retry-After (bounded to one hour); transport failures drop the
batch. There is no persistent queue or durable-delivery promise.

`POST /_bedrock/errors` is intercepted by the daemon **before any wake**, even
for idle/stopped pebbles. Matching Origin and the retained release's access
policy are required; anonymous public-pebble reports are untrusted. Cookies and
authorization are discarded after admission and never enter storage. Missing
retained policy fails closed to creators. Only JSON/text/plain versioned
`{ v: 1, events: [...] }` is accepted: 1–5 events, 48 KiB per streamed body,
16 KiB per event, 20 bounded frames, no compression. Body reads have a
five-second deadline and 16 global admission slots. Browser-supplied runtime
and mapped-frame flags are ignored. Oversized/malformed requests return 413/400;
unsupported encodings/content types return 415. Capacity returns 429 with
Retry-After. Per pebble/fixed minute the total is **120 events**, of which
browsers can consume at most 90, reserving 30 for server crashes. The daemon's
queue including its in-flight batch is 1 MiB/256 events; browser admissions
stop at 768 KiB/192 events. Drops are exposed, never recursively reported.

Unexpected query/mutation/route (including detached), job, application socket,
service and startup throws are reported over child IPC before conversion to
responses/wrapped errors. A BedrockError with status below 500 is an expected
client failure and is excluded. Bun already provides original server TS stacks.
The child deduplicates Error objects and caps IPC reports at 120/minute.
Telemetry does not change transaction outcomes or process termination behavior.

The M1 telemetry Worker also owns `$BEDROCK_HOME/errors.sqlite`, a separate
physical file so error data cannot consume the 512 MiB telemetry budget. It stays
on the home disk, not the pebble data disk. **All error data, including issue
state, is disposable and excluded from backups.** No runtime dependency is added.
The global logical payload ceiling is **1 GiB** with conservative JSON/row
charges. A 480 MiB SQLite page ceiling, nonwaiting locks, disabled page spills,
and truncate checkpoints before/after each event independently keep DB + WAL
below 1 GiB. Physical exhaustion drops ingestion and retries after a minute;
serving does not wait. Logical pressure evicts oldest samples in bounded passes.

Payload visibility expires after **14 days**; daily issue/release counts and
digest transitions after **90 days**. A bounded sweeper runs on writes, reads
and every minute (physical deletion may lag a large expiry backlog). At most
20 samples are admitted per issue/release/UTC day, even after eviction; noise
keeps counts only. Issue/fingerprint metadata is capped at 10,000 fingerprints.
Browser fingerprints (including merged aliases) are limited to 1,000 per pebble
and 8,000 globally, reserving at least 2,000 slots for server fingerprints.
Existing groups keep counting at these limits; new groups drop with
`browser_issue_budget` or `issue_budget` counters. After 90 days without activity,
issues and their fingerprints, merge aliases, samples, counts and transitions are
reclaimed in bounded passes before admission. Resolved/ignored state is kept for
issues with recent activity. Retry deduplication covers the most
recent 20,000 event IDs. List pages contain at most 100 issues; detail returns
20 newest retained samples; count results are capped at 1,000 rows. Missing
history is not zero occurrences.

Fingerprint v1 hashes runtime + exception type + up to five nearest mapped app
frames (relative path, mapped function or anonymous, positive original line),
excluding dependencies and Bedrock wrappers. Messages, columns and release IDs
are not fingerprint inputs. No fuzzy line-shift merging is promised. With no
mapped app evidence, same-type errors share an empty-frame group; `missing_maps`
remains visible rather than inventing original frames. Browser symbolication uses
a 64 MiB byte-accounted LRU of private parsed/indexed maps and deduplicates exact
positions per batch. Each batch allows 100 ms of symbolication, 8 MiB of map/
manifest input, and 256 distinct positions (manifests also cap at 1 MiB).
Maps exceeding cache capacity or remaining work fall back to visibly unmapped
frames; repeated or out-of-range frames cannot monopolize the telemetry Worker.
Extension-only stacks
use a quarantine namespace; ResizeObserver loop errors use a count-only noise
namespace. Neither emits digest transitions. Coarse browser family and a bot
boolean are the only user-agent derivatives; bots remain tagged, not trusted.

Both client and daemon scrub emails, IP literals, URLs' origins/credentials/query
strings/fragments, bearer/JWT/token patterns and credential assignments with
quoted or unquoted keys/values (including password/passwd, secret, token,
api_key/api-key, authorization, cookie/set-cookie, session and bearer).
Quoted values are redacted in full, including spaces and escaped quotes;
unquoted credential values conservatively redact through the next comma,
closing brace or newline, including authorization/cookie spaces and semicolons. The Worker
also scrubs known pebble secrets (at least four characters where available),
including mapped frames. The Worker reads current secrets per batch/query even
without a child, retains known values through rotations, and fails closed if
secrets cannot be read; reads reapply known secrets to text fields. Bodies, request
headers, cookies/auth, user/session IDs, raw user agents and arbitrary rejection
objects are never collected. Free-form error text can still contain private
application values: use beforeSend or avoid putting them in exceptions.

```sh
bedrock errors notes --json
bedrock errors show notes <issue> --json
bedrock errors resolve notes <issue> --json
bedrock errors ignore notes <issue> --json
bedrock errors merge notes <source-issue> <target-issue> --yes --json
```

These commands accept --url/--token; list accepts --cursor. API equivalents are
GET `/api/pebbles/:name/errors[/:issue]?cursor=<number>` and POST
`/api/pebbles/:name/errors/:issue/resolve|ignore`; merge uses
`/api/pebbles/:name/errors/:issue/merge?confirm=true&target=<id>`.
Reads require scoped **logs**; changes require **lifecycle**, both restricted by
pebble globs. Detail and changes return `NOT_FOUND` when the issue does not
belong to that pebble; merge requires both issues in the same pebble.
Browser collection grants no issue-read permission. Resolve and
ignore are idempotent; merge keeps fingerprint aliases and daily counts and
caps merged samples at 20/day/release. A recurrence reopens a resolved issue;
ignored issues keep counting without reopening. Merge requires --yes; resolve/ignore need no confirmation.

For M2, `telemetry.errors.onIssue(callback)` exposes committed new-issue and
regression transitions with `{ id, pebble, issue, kind, time, delivery: "digest" }`.
Durable catch-up is GET `/api/pebbles/:name/errors/transitions?after=<id>`
(scoped logs, 100 rows/page, 90 days), using the last returned ID as the cursor.
Callbacks are best effort; M2 should persist its cursor and use catch-up across
restarts. Error transitions are digest inputs, never page requests.

### Daemon telemetry

The daemon owns `$BEDROCK_HOME/observability.sqlite`, separately from identity
and pebble data. It stays on the home filesystem when `dataDir` moves pebble
storage. It is disposable and excluded from daemon/pebble backups. No pebble
configuration, imports or runtime dependencies are needed.

One Worker owns every SQLite connection, read, write, checkpoint and cgroup
sample. The daemon batches at 1 s or 256 records; its ingestion queue (including
the acknowledged batch) is capped at 4 MiB / 4,096 records. Text leaves room for
metrics/lifecycle. RED is aggregated without sampling before enqueueing; losing a
batch loses its aggregate counters and increments explicit drops. Serving never
waits for this Worker. Telemetry API reads can wait for preceding batches (up to
the 5 s Worker watchdog); they do not hold a reader open while streaming.
SQLite uses WAL/NORMAL, an 8 MiB cache, nonwaiting locks, bounded deletion and
incremental vacuum. A single connection avoids concurrent WAL reset/checkpoint
races, including on older SQLite builds. The Worker checkpoints after batches.

Logical budgets precede time retention: logs **256 MiB**, diagnostic events
**64 MiB**, metrics including resources **160 MiB**, lifecycle **32 MiB**.
Accounting charges compact payloads plus row/index and log FTS allowances.
Metrics reserve 4 MiB for the status tier, 32 MiB for raw resources, 96 MiB
for minutes, 22 MiB for hours and 6 MiB for days; pressure evicts oldest rows
within the affected tier and counts evictions. Empty traffic classes are not
stored. Sparse histogram buckets and resource values use compact positional
encoding on disk; API fields and histogram arrays are unchanged. Older payloads
are compacted incrementally when opening/writing the store. Other categories
evict their oldest records. If space cannot be reclaimed within a bounded pass,
new records drop. Independently,
the SQLite page limit caps the DB at 248 MiB. Dirty-page spills are disabled,
and each batch must first truncate its WAL: even a transaction rewriting the
whole DB fits with its WAL below the **512 MiB** physical budget. This conservative
physical cap can shorten coverage before all logical budgets fill. It remains
248 MiB to cover a worst-case full-DB WAL transaction (including frame overhead)
without relying on a soft WAL size limit. Physical pressure reclaims raw
resources/logs/events/lifecycle, then minute/hour/day history, and the status
tier last. Ingestion also stops at a 64 MiB WAL backstop, including externally pinned readers. Disk
admission uses the normal 64 MiB free-space margin plus a batch reserve.
`SQLITE_FULL`, ENOSPC and EDQUOT follow `DISK_FULL`: drop, one daemon stderr
notice per outage, retry once a minute. Other storage failures drop as well.
Worker crashes/watchdog failures lose acknowledged-in-progress data, count drops
and restart after 1 s. Resource polling retries storage even when there are no
measurable children. Counters are reported per daemon boot; successful batches snapshot them for historical drop
reporting. Unsaved drops can be lost on a daemon crash.

HTTP rollups use UTC **1 m / 7 d**, **1 h / 90 d**, **1 d / 365 d** intervals.
An internal 1 s / 5 min tier supplies the rolling status window. Parents are
updated atomically with children, never by merging percentiles. Resource samples
retain 15 s / 24 h detail and the same minute/hour/day rollups. Events and
lifecycle retain 90 d; logs retain 7 d. Byte limits may shorten any coverage.
Maintenance deletes at most 1,000 expired rows per batch, so time expiry is
incremental. Coverage includes retained record bounds and the latest 128 writer
intervals (up to 4,096 stored); missing data and restarts are **unknown**, never
zero traffic. Read responses include requested range, cursor and drop counts.

RED and saturation have only pebble and traffic-class dimensions: `ordinary`,
`stream` (SSE/NDJSON/stream content types), `websocket`, `control` (reserved HTTP
paths and supervisor IPC). Unknown hosts never create series. Starts are counted
at admission, including cold wake, then assigned to stream at headers-ready if
appropriate. Completions follow proxied body consumption/cancellation, not proven
last-byte delivery. Failures count once for 5xx, fetch/transport or body failure;
client aborts and 4xx/429 have separate counters. Client aborts do not enter latency
histograms. WebSockets count handshakes separately; completion/lifetime refer to
connection close. Current in-flight/open sockets, peaks and gauge integrals are
available separately from counters. Headers-ready and lifetime histograms are
split success/failure, version 1, noncumulative seconds buckets:
`.005,.01,.025,.05,.075,.1,.25,.5,.75,1,2.5,5,7.5,10,+Inf`.
`p95` is `{lower,upper,unit:"s",count}`, with `upper:null` for overflow and
`null` for no samples. Sums/maxima are also retained.

Every failure and request over 1 s is eligible for a diagnostic event, plus 1%
of successes. Events have a 10/s/pebble cap with drop counts; RED remains
unsampled. Event fields are allowlisted: bounded method/status/outcome, duration
and route shape. Known public-route keys up to 256 characters are preferred; **all** segments of
unknown paths become `:segment` (at most eight). No query strings, bodies,
headers, cookies, credentials, identities, IPs or user agents are captured.
Route shapes are never metric dimensions.

Every 15 s, the Worker reads existing live child cgroups, summing both children
during deploy overlap: `memory.current`, `memory.swap.current`, `cpu.stat`
`usage_usec` deltas, `memory.events` `oom_kill` deltas. A first/reset sample
establishes a baseline; CPU 100% means one core. Resource rollups preserve CPU
consumption, covered duration, memory/swap integrals, peaks and last values.
Missing/unreadable cgroups, idle children and non-Linux yield explicit nulls
in status without persisting null resource samples; a stopped child cannot
leave a stale resource value in status. Sampling never wakes a pebble and never
infers OOM from SIGKILL alone. Lifecycle records include spawn, ready, exit/crash
(code and signal), retry time, idle, wake, hibernate, stop, activation/deploy and
retirement, with the child run/release identifier.

New stdout/stderr lines are authoritative in SQLite with FTS5. They retain
stream/run, use daemon ISO timestamps for text output and cap each line at
16 KiB. Per-pebble limits are 50 lines/s and 128 KiB/s with drops/truncations
counted. A line without a newline keeps at most 64 KiB while awaiting its end,
then stores only the capped prefix. Pipe processing yields during floods.
Configured secrets of at least eight characters and JSON-escaped variants are
redacted before enqueueing and again in the Worker; logs read through the API
are scrubbed again with current configured secrets. Applications must still
avoid logging private data or deliberately encoded secrets. stderr is a stream,
not an inferred error severity. `logs/cloudflared.log` retains its existing file
rotation and own timestamps.

Existing `pebbles/<name>/logs/pebble.log{,.1,.2,.3}` are left in place and never
written again. Plain `bedrock logs <name>` / the text logs API includes their
bounded tail before recent SQLite history; `--follow` adds live accepted lines
with bounded subscriber buffering (1 MiB of live data during initialization;
overflow closes the follower). Subscription precedes history reads; a stable
per-boot acceptance watermark separates history from buffered live lines,
including lines sharing a timestamp or identical text. Follow is best effort and can show an
accepted line before its storage batch fails. JSON/search/paginated history
covers SQLite only; old files are not indexed/imported and may be removed after
inspection. Deleting a pebble purges its stored telemetry asynchronously.

```sh
bedrock status --json
bedrock metrics notes --since 1h --step 1m --json
bedrock logs notes --search '"connection reset" OR timeout' --since 1h --json
bedrock logs notes --follow
```

`status` adds `telemetry` per pebble: now, last 5 min RED by class, latest
resources/lifecycle, coverage and drops. Human output includes these fields;
JSON preserves the existing status fields and Bedrock envelope. Idle pebbles
remain asleep. `metrics` and JSON/search `logs` return `{ok:true,value:{rows,
cursor,range,coverage,writer_coverage,drops,historical_drops,retained_losses,…}}`
(with CLI command/name metadata). Cursors are opaque; pass `--cursor` unchanged.
`--limit` is 1–1,000. `--since` is a positive integer `s|m|h|d`, at most 365 d;
metric `--step` is `1m|1h|1d`. `--follow` (`-f`) cannot combine with search,
since or cursor. JSON follow preserves the single JSON string stream and appends coverage/drop metadata when it closes.

Creator-authenticated GET `/api/pebbles/:name/metrics|resources|lifecycle` uses
scoped deploy action `status`; `/events|logs` uses `logs`. Pebble glob scope
applies to every endpoint. Parameters: `since`, `from`/`to` (epoch ms), `step`,
`limit`, `cursor`; logs also `q` (FTS5, at most 1,024 characters) and
`format=json`. Plain `/logs` remains text; `follow=true` streams text.
Malformed ranges/FTS/cursors return `INVALID_ARGS` with a hint; storage outages
return `TELEMETRY_UNAVAILABLE`/`DISK_FULL`. Status stays available with explicit
unknown coverage and `unavailable:true` if telemetry is down. See the readiness and alerting contract below.

`restart: true` requires an existing deployed pebble. The normal restart now
launches and health-checks a replacement before switching routing and retiring
the old child, while retaining release/rollback selection. The old child keeps
serving on failed non-exclusive startup. Exclusive startup happens after the
old child exits; its failure returns `exclusive_services: "failed"` with the
replacement still selected. Secret changes remain saved if restart fails, and
will be used on the next successful launch. Secret changes and service-token
operations share the per-pebble deploy/lifecycle exclusion lock; concurrent work
returns 409 `PEBBLE_BUSY`. Without restart, the current child retains its previous
environment until its next launch.

CLI (all accept `--json`, `--url` and `--token`):

```sh
bedrock secrets ls upty --json
printf '%s' "$DISCORD_TOKEN" | bedrock secrets set upty DISCORD_TOKEN --restart
bedrock secrets set upty DISCORD_TOKEN   # hidden prompt on a terminal
bedrock secrets unset upty DISCORD_TOKEN OTHER_SECRET --restart
bedrock token create --name manager --pebbles "upty,bot-*" \
  --actions deploy,lifecycle,logs,secrets,status,service-tokens --json
bedrock token ls --json
bedrock pebble-token create upty --name agent --permissions query:status --as you@example.com --json
bedrock pebble-token revoke upty <id> --as you@example.com --yes --json
bedrock session create upty --ttl 15m --as you@example.com --json
```

Secret set accepts exactly one name, reads the value from stdin or a hidden
prompt, preserves whitespace, and never accepts a value on argv. Unset accepts
one or more names. Secret commands return only metadata.

Deploy tokens gain nullable `name`, JSON `scope` and `user_id` columns through
migration 0003. Existing email-bearing tokens have their owner backfilled from
`users`; creator login records the owning user on new tokens. Tokens created
through `POST /api/tokens` inherit the calling token's owner; callers cannot
choose another owner. Its optional body is `{ name?, scope?: { pebbles: string[],
actions: string[] } }`. Null scope retains full access. Scoped creation requires
both nonempty arrays. Pebble globs use full-name matching with `*` (any sequence)
and `?` (one character), lowercase letters, digits and hyphens only. Actions are:

- `deploy`: POST deploy, including a first deploy, for matching names.
- `lifecycle`: start, stop, restart, rollback and confirmed deletion.
- `logs`: read and follow logs.
- `secrets`: read and update secrets (including requested restart).
- `status`: GET `/api/pebbles` and `/api/status`, filtered to matching pebbles,
  plus per-pebble metrics/resources/lifecycle (see [Daemon telemetry](#daemon-telemetry)).
  Status retains daemon version/features/domain needed by deploy clients; it
  omits tunnel information and does not disclose creator session presence.
- `service-tokens`: create and revoke target pebble tokens.

Scoped tokens receive 403 `FORBIDDEN` with a repair hint for missing actions,
unmatched pebbles, token management, self-update, backups, jobs, host/config and
all other ungranted endpoints. There is no scoped route granting global admin.
`GET /api/tokens` / `token ls` return scope as an object or null.

`POST /api/pebbles/:name/service-tokens` accepts `{ name, permissions: string[] }`
and returns `{ id, token }` (the raw `brk_` token once).
`DELETE /api/pebbles/:name/service-tokens/:id` returns `{ revoked: true }`;
repeat revocation of an owned token is idempotent. The running target must declare
`tokens: true`; otherwise it returns 409 `TOKENS_DISABLED` (or 409
`PEBBLE_STOPPED` if not running). The supervisor sends the owning creator user
and operation through parent/child IPC. The child invokes `ctx.tokens.create`
or `revoke` in an executor mutation slot, with identical validation, hashing,
ownership and transaction rules to ordinary pebble tokens. No daemon SQLite
connection writes to the pebble DB. Invalid registered permissions return 400
`INVALID_TOKEN_PERMISSION`; wrong ownership returns 403 `FORBIDDEN`.

`bedrock pebble-token create <pebble> --name <name> --permissions <a,b>` calls
this API and prints the raw token once; `pebble-token revoke <pebble> <id> --yes`
revokes it. Both accept `--as <email>`, `--url`, `--token`, and `--json` (one JSON
value on stdout). There is no service-token list API, so no CLI `ls` command.

The local admin token may select an **already existing, configured creator** with
`--as <email>` (API query `?as=<email>`). Its identity is the exact token loaded
from `$BEDROCK_HOME/admin-token`, never the request's source address: tunneled
requests can arrive from loopback too. Unknown users get 403 `CREATOR_NOT_FOUND`;
non-creators get 403 `FORBIDDEN`, with repair hints. This never creates a user,
adds a creator, or persists an owner on the admin token. Under ARCHITECTURE.md §8,
the host user already runs the daemon and its trusted code, so selecting an
existing creator adds no real power. A creator login token acts as itself;
`--as` may repeat its own email but cannot switch identity. Ownerless legacy or
manual tokens still cannot mint/revoke service tokens, even with `--as`.
403 `TOKEN_OWNER_REQUIRED` points to the working server commands above, or to
running `bedrock login <domain>` on the computer with the browser.
IPC failure on child exit returns `PEBBLE_STOPPED`; 15-second timeouts return
`SERVICE_TOKEN_TIMEOUT`. A timed-out creation may have committed, so callers
must not assume that no token was created. Ordinary pebble tokens remain in
`data/db.sqlite` and are included in database backups.


### Readiness, jobs and alerts

`/_bedrock/health` remains child liveness and deployment metadata. Readiness is
private IPC: migrations completed, `sqlite_schema` readable, and **all declared
services** successfully started (including exclusive services). A child reports
`ready`, `degraded` (services unavailable), `failed` (DB unreadable), or `stopped`;
the daemon adds `starting` and `idle`. This tests local resources, not external
service connectivity or application correctness. Diagnostic DB reads disable
SQLite lock waits for the synchronous read, restoring the application timeout
afterwards. Services that fail later must
let their process fail or expose their own application diagnostics.

The daemon probes existing running children every 30 s, with two concurrent IPC
requests, a 2 s deadline and no overlapping sweep. Three failures open the check;
two successes recover it. A readiness page requires two minutes unhealthy or the
supervisor's `crashed` state. Probes never call `ensure`, extend inactivity, or
count as application traffic. A child replaced during a probe remains registered
with starting/unknown readiness; only registry removal triggers deletion cleanup.
Idle means **available on demand**, never probed awake; hibernation still means running. `bedrock status --json` includes
`readiness: { state, observed_at }` (idle also `available_on_demand:true`). No
recent observation (>65 s) is `starting`/unknown, never a fabricated green.

Unauthenticated `GET https://bedrock.<domain>/healthz` returns exactly 200 and
`bedrock-health-v1\n` when the daemon can read its registry; otherwise 503 and
`bedrock-unavailable-v1\n`. Plain text, no redirects, no names/counts, no-store,
fixed body under 32 bytes. Only the daemon hostname exposes this route. An
external prober must enforce status **and** exact body, disable redirects and
cache, and bound response size; configure a Cloudflare cache bypass for this
path. This says nothing about individual pebbles. Whole-host/edge/network failure
requires the external watcher (M5), independent of this host and webhook target.
Locally, tunnel detection means cloudflared process presence, not proof of an
established connector or public reachability.

The daemon's SQLite Worker retains cron/release metadata and next expected
occurrence independently of the child scheduler. Jobs emit correlated
`scheduled`, `started`, `succeeded`, `failed`, `skipped` and `interrupted` IPC
events; success follows executor commit/detached completion. Manual runs have no
scheduled occurrence. Start grace is 5 min; runtime budget is 10 min (includes
queue wait). Exceeding the budget records an incident and never kills/replays a
job. On child death or daemon restart, unfinished starts become interrupted.
Missed occurrences during a restart/gap become one episode per job; no catch-up.
Deadlines advance from the previous expected occurrence, checking each overdue
occurrence before advancing; a successful earlier run cannot hide a later miss.
Intentionally idle/stopped pebbles have no expected-run pages. Removed jobs and
pebbles resolve their obsolete incidents on the next sweep.

Criticality belongs to the **host config**, using existing job names, with no new
`job()` option or pebble primitive:

```json
{
  "alerts": {
    "webhook": "https://comms.example.test/api/v1/messages",
    "criticalJobs": { "notes": ["sync"] }
  }
}
```

No jobs are critical by default. Only four conditions page: a configured tunnel's
process is absent; desired-running readiness remains unhealthy for 2 min or the
supervisor enters a crash loop; an explicitly critical job fails/is interrupted
or misses its deadline; a configured backup target has no successful backup for
more than twice its interval. Backup age is per pebble and daemon, including
stopped/idle data. A never-backed-up target gets a persistent initial 2-interval
grace; partial successes do not hide another target's stale backup. Probe sweeps
reload backup configuration, so backup setup, interval edits and removal apply
without restarting the daemon.

Delivery failure >10 min creates a **local-only** `alert-delivery` incident and
one stderr repair notice per episode. It cannot page through itself; the owner
must inspect alerts or use independent external monitoring. It resolves when
webhook submission resumes. Acceptance by a webhook is not provider delivery or
human acknowledgment. Ordinary job failures, skipped runs and interruptions go
to the digest. CPU/memory/request spikes and isolated failed probes never page.

Incident fingerprints are JSON `[host, pebble, rule, job]`, stable across release
and restart, with one incident per episode. Each page opening/resolution commits
with exactly one immutable outbox row/key in the same transaction. A 30 s group
window batches eligible transitions in each delivery sweep; it does not combine
several transitions into one payload. Transitions for an incident submit in
stored order: recovery waits for acceptance of its opening, including across
Retry-After delays and restarts. Other incidents can still submit. Child-readiness
messages wait beneath an open tunnel incident. A child recovering while inhibited produces no delayed
page. Unrelated job/backup incidents remain eligible. Exact-fingerprint silences
have an expiry; unresolved pages become eligible after expiry. Silences and
inhibition retain the incident evidence. There is no acknowledgment API yet.

Webhook URL uses HTTPS (HTTP only for loopback), no URL credentials, query or
fragment. `alerts-secret` is an atomic 0600 file in BEDROCK_HOME, like backup
credentials. It never enters a child environment or API response. Destinations
in this daemon's `<pebble>.<domain>` namespace use its actual loopback proxy port,
preserving Host/path and normal access checks, including waking idle pebbles.
They never traverse cloudflared; external webhooks keep their configured URL.
Configure it on the daemon host, then restart; URL defaults to comms on this
domain:

```sh
# Dedicated bedrock-monitor client token, from stdin or a hidden terminal prompt:
bedrock alerts setup --json
bedrock alerts setup --webhook https://notify.example.test/messages --json
bedrock alerts test --json
bedrock alerts --json
bedrock alerts silence '["example.test","notes","readiness",""]' --for 2h --json
bedrock jobs history notes --json
```

`test` durably queues a non-critical test message; inspect its outbox state for
acceptance. Only non-critical push notifications (including tests) wait during
23:00–07:30 **Europe/Brussels**. Critical incident openings, resolutions,
escalations and reminders bypass both Bedrock's and comms' quiet hours using
`urgency:"high"`. Tests use normal urgency; email digests use low urgency.
The comms-compatible JSON payload has `to:["me"]`, subject/text, urgency,
explicit channels, `idempotency_key`, and metadata (incident, rule, target,
fingerprint). Initial/resolution messages use Poke. Unresolved incidents escalate
after 15 min to ntfy + email, then remind at most once per 6 h, all with separate
durable transition keys. Comms owns provider routing/retries. Existing immutable
outbox payloads retain their original urgency across upgrades.

The generic receiver gets `Authorization: Bearer …` and `Idempotency-Key`, plus
the same key in the payload. It must accept the comms-shaped payload and dedupe
unchanged retries. Any 2xx means accepted. Redirects fail; response bodies are
cancelled unread. At most 16 submissions per sweep, a 2 s network deadline,
exponential retry 1 s to 6 h (including persistent auth/config failures, surfaced
locally); numeric Retry-After seconds are honored up to 6 h. Pending payloads
survive restarts and never change under the same key. HTTP/provider details or
secrets are not retained in errors. Idempotency lasts only as long as receiver
retention; this is at-least-once submission, not exactly-once provider delivery.

Weekly Monday 08:00 **server local time**, or the first observation afterwards,
a low-urgency email digest includes unresolved incidents, job failure/skip counts,
latest probe observations and outbox counts. A daily digest is enabled only while
incidents remain unresolved; one per local date, persisted across restarts. No
missed digests are replayed. Text is bounded to 24,000 characters. Quiet-hour
email bypass applies to digests; critical escalations also bypass quiet hours.

`GET /api/alerts`, `POST /api/alerts/silence` (`{fingerprint,for:"2h"}`),
`POST /api/alerts/test`, and `GET /api/jobs/:pebble/history` require an **unscoped
creator token**, like existing job control and host configuration. Scoped status
still includes only matching pebbles' readiness; it cannot read global incidents,
job history, silences or the outbox. Alert APIs use Bedrock envelopes/no-store.
`alerts` returns open/recent incidents, active silences, checks, and outbox
metadata/counts, not payloads or credentials; history returns newest 1,000 events.

Storage is `alerts.sqlite`, separate from M1 telemetry so telemetry retention and
Worker outages cannot remove pending notifications. All monitoring writes run in
a separate Worker; store failure leaves serving/canary independent and surfaces
`ALERTS_UNAVAILABLE`. Worker crash retries after 1 min; at most 128 pending IPC
operations, 5 s response deadline. Probes have constant-size current-state rows;
job history is 30 days/100,000 events globally. Accepted/suppressed transitions
and resolved incidents expire after 365 days. At most 1,000 pending outbox rows;
a full outbox rejects/rolls back a new transition (the condition is evaluated
again next sweep), never evicts pending delivery. Terminal job events persist a
pending-evaluation marker with their history row; the marker clears only when
incident/outbox evaluation commits, and is retried in event order after saturation
or restart. Retention excludes these pending events. SQLite has a 64 MiB page
budget;
WAL autocheckpoints every 256 pages. Retention runs before evaluation/job-event
admission and independently during delivery, so a failed evaluation cannot block
cleanup. Under byte pressure, accepted/suppressed outbox history, unreferenced
resolved incidents, then evaluated job history are reclaimed early to reserve
4 MiB for pending work (one quarter of the page budget if smaller). Pending
transitions/evaluations are never evicted. These are bounded diagnostic histories,
not an audit archive. Alert state/credentials are not included in existing daemon DB
backups; retain BEDROCK_HOME for outbox durability.

### One-time creator session links

`bedrock session create <pebble> [--ttl 15m] [--as <email>] [--json]` returns
`{ ok: true, command: "session create", value: { url, expiresAt } }`. Like other
remote commands it accepts `--url` / `--token`. It calls
`POST /api/pebbles/:name/sessions[?as=<email>]` with `{ ttl?: "15m" }`. The pebble
must be deployed; no token opt-in is needed. Only unscoped deploy tokens can
create sessions, with the same existing-creator selection rules as above.
Durations use integer `s`, `m`, or `h`, default to 15 minutes, and must be positive
and at most one hour (`INVALID_ARGS` otherwise). Expiry is measured from issuance,
not redemption, and is returned as Unix milliseconds.

The URL opens `https://<pebble>.<domain>/_bedrock/session#<secret>`. A GET renders
an explicit confirmation form; it never consumes the link. A CSP-hashed script
moves the fragment into a hidden POST field and removes it from browser history.
JavaScript and a button press are required: GET link scanners cannot burn links.
Fragments never enter HTTP request URLs or access logs, and Bedrock never logs
the secret or forwards it to the pebble. The confirmation page and redemption
response use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

The daemon stores only a SHA-256 hash in `session_links`, bound to the user,
pebble, and expiry. Redemption requires the exact pebble Origin, rechecks creator
membership, and consumes the link and creates a session atomically. Concurrent
redemptions yield at most one session. Invalid, unknown, expired, or reused secrets
submitted to the form get the existing styled error page (`INVALID_SESSION_LINK`).
A successful POST sets the ordinary HttpOnly/Secure/SameSite session cookie and
redirects 303 to the clean pebble root. Its fixed expiry is the link's original
expiry; neither HTTP nor WebSockets slide it to the normal 30-day lifetime.
The entry URL is pebble-bound, but the resulting identity is an ordinary global
creator session, valid across the domain until that expiry. Treat an unused link
as a creator credential; its first redeemer gets that identity. These are daemon
operations and require no new pebble author API.

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
`http://127.0.0.1:<port>` and `http_status:404` catch-all. Hostname rules added
by hand (`- hostname:` plus `service:`, with plain or double-quoted values) are
kept, ahead of the wildcard, when setup runs again, and setup may rewrite the
wildcard's port. Any other hand edit (other keys or quoting, a second wildcard
rule, a catch-all other than one final `http_status:404`) makes setup refuse with
`TUNNEL_CONFIG_CUSTOM` and leave the file untouched. The daemon supervises
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
`tunnel status`/doctor check local credentials and YAML for local mode (the tunnel
ID, credentials path, wildcard rule and final catch-all must be present; extra
hostname rules and unrecognized lines are returned as `extraIngress` and
`unrecognized`, and doctor warns about them because they bypass the daemon's
access checks), plus DNS
when a transient API token is available; remote mode checks ingress/DNS via API.
Both also use doctor's independent wildcard DoH check.
`tunnel teardown --yes --api-token <token>` safely deletes only matching DNS and
the saved tunnel in either mode. Local mode discovers its account/zone first,
then removes its credentials and YAML. Stop the daemon before teardown.
Repeating setup/teardown is safe; adding pebbles needs no Cloudflare calls.

## 10. Composition, jobs and routes

Composition uses ordinary TypeScript modules. Export maps from a module and spread
them into the pebble; the same pattern works for sockets and services:

```ts
import { definePebble } from "bedrock";
import * as audit from "./audit";

export default definePebble({
  name: "notes",
  schema: { ...audit.schema },
  routes: { ...audit.routes },
  jobs: { ...audit.jobs },
});
```

Choose distinct map keys: later object spreads overwrite earlier keys before
Bedrock sees them. Register each table once; duplicate SQL table names throw
`DUPLICATE_TABLE` with a repair hint.

Drizzle job and route writes notify sync automatically after commit. For raw SQL:

```ts
ctx.db.$client.exec("DELETE FROM audit_log WHERE created_at < 0");
ctx.invalidate([audit.schema.auditLog]);
```

- `jobs: { name: job(cron, async ctx => ...) }` is supported on pebbles.
  Five numeric cron fields support `*`, lists, ranges, and steps in server-local
  time. Restricted day-of-month/day-of-week use traditional OR semantics.
  By default, jobs execute in the pebble's write queue with `user: null` (bypassing pebble
  access, retaining bucket policies), invalidate sync after commit, log named
  failures, and skip overlapping runs of the same job. There is no catch-up;
  overlap protection is process-local. The daemon retains execution history and
  expected deadlines (see [Readiness, jobs and alerts](#readiness-jobs-and-alerts)).
- `bedrock jobs ls <pebble>` and `jobs run <pebble> <job>` use the authenticated
  daemon API and the IPC control channel to the child.
- Route handlers keep `(request, server)` and receive FunctionContext as a third
  argument, including `{ db, user, storage, invalidate }`. By default they run inside write
  transactions. Normal routes enforce pebble access in both daemon and child;
  `publicRoute(handler)` or `publicRoute(detached(handler))` opts only that HTTP
  handler into the anonymous semantics in §5. Functions and jobs also expose invalidate.

Custom HTTP routes may set `definePebble({ maxRequestBodySize: bytes })` (positive integer, default 90 MiB, maximum 1 TiB). The daemon ceiling is 1 TiB and forwards request bodies as streams; custom routes must stream them to bound memory. Storage bucket limits remain separate. Application sockets retain the original URL and headers before upgrade, including on Bun 1.2.

Proxied pebble HTTP requests have no idle timeout, so slow handlers and long streams work; Cloudflare still applies its own ~100-second limit for time to the first response byte.

Queries, mutations, transactional routes and jobs, storage requests and each
detached `ctx.read`/`ctx.write` run as one slot of the pebble's serialized queue;
a slot that awaits anything slow holds every other database request. Every slot
is timed from when it starts (the previous slot has released) to when it ends.
A slot longer than `BEDROCK_SLOW_SLOT_MS` (milliseconds, default 200, read when
the runtime starts) logs one `console.warn` line naming its kind (`query`,
`mutation`, `route`, `job`, `storage read`/`storage write`, `detached read`/`detached write`), its
name (function name, `METHOD /path` route key, job name, or request path) and
its duration. When at least half of the time was the `COMMIT` itself, the line
adds `(commit N ms)` and recommends batching writes and checking held readers,
competing SQLite connections and checkpoint fallback warnings. Storage or lock
contention can dominate even on a fast disk; a faster disk alone may not fix it. After one warning,
further slow slots with the same kind and name are counted for 60 seconds and
reported as one summary line (`was slow N more time(s) in the last 60 s (max M ms)`). In `bedrock dev`, in tests that call `startPebble` directly, and
in production when the daemon runs with `BEDROCK_STRICT_SLOTS=1`, calling
`fetch()` inside a slot throws `NETWORK_IN_SLOT` (HTTP 500), so a mutation that
fetches rolls back. Fetches outside slots, including detached handlers and
services while another slot is open, are unaffected; production without the
flag never replaces `fetch`. The daemon forwards both variables from its own
environment to pebble processes. Fix either signal by moving the slow work into
a detached route, a detached job or a service and keeping only the database part
in `ctx.write`/`ctx.read`.

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
semantics as queries and mutations. Await every slot, keep network I/O outside callbacks (see above), and do not
retain a slot's context. A failed slot rolls back only itself; earlier committed
slots survive later handler errors. Writes notify sync after each commit.
Normal detached routes retain daemon and child access gating and signed user
identity. Wrapping them in `publicRoute` uses the anonymous semantics in §5. Jobs keep `user: null` in every slot, process-local overlap
protection, scheduling, and `bedrock jobs run`. Existing routes/jobs remain
transactional by default.

## 11. Application sockets and long-lived services

Pebbles may declare application sockets independently of sync:

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

Socket paths are absolute and outside `/_bedrock`; service names must be
letter-led identifiers, excluding `constructor`, `prototype` and `__proto__`.
A socket cannot share a GET route. One Bun WebSocket handler dispatches sync and application connections by
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

`service({ start(ctx), stop?(value), stopTimeout?: milliseconds, exclusive?: boolean })`
returns the awaited start value to all function, route, socket and job contexts
through `ctx.services`. ServiceContext is `{ pebble, dataDir, read, write, log,
signal }`; raw SQL invalidation belongs inside `write` through its
FunctionContext. It has no lifetime transaction. `exclusive` must be a boolean
when supplied; invalid values throw hinted `INVALID_SERVICE`.

Non-exclusive services start in map declaration order, after migrations and
before HTTP/health and child readiness. A failed start throws hinted
`SERVICE_START_FAILED`, aborts the signal and unwinds earlier services. Later
startup failures also unwind services. Exclusive services start after all
non-exclusive services, in their own declaration order, once the previous child
has exited. Non-exclusive services must not depend on exclusive ones. Exclusive
services can access earlier values through `ctx.read`/`ctx.write` contexts.
Standalone `startPebble` starts both groups before returning; the daemon uses
`deferExclusive: true` and the running object's idempotent `startExclusive()`.

Use `exclusive: true` for a service that owns a port, browser profile, lock or
upstream sync. Within one daemon, it never runs in two releases of the same
pebble at once, across deploy, rollback, restart, crash restart and daemon
stop/start. HTTP, sockets and non-exclusive services retain the health-gated
zero-downtime swap. There is a gap with no exclusive instance, from old stop
through new exclusive startup. Handlers touching that service during the gap
throw hinted `SERVICE_NOT_STARTED` rather than receiving `undefined`. A local
five-handoff measurement with a trivial service measured 0.587–1.501 ms (median
0.619 ms) from observed old process exit to new start entry; drain, old cleanup
and the new service's own startup add to the total gap. This is a measurement,
not a latency guarantee; a full-suite run measured a 1.542 ms median.

Deploy, rollback and restart results include
`exclusive_services: "none" | "running" | "failed"`. A failed exclusive start
unwinds the exclusive services already started, then stops the child and exits
non-zero. Normal crash backoff retries it and marks it `crashed` after five
rapid failures. The replacement is already selected: this is a successful
release selection with `"failed"`, not `DEPLOY_FAILED` claiming the previous
release is still selected. The CLI warns on stderr with `bedrock logs <name>`,
also for JSON output. Pre-activation failures retain the previous release.

Stopping closes the listener, sends 1012 "Service restart" to sockets, aborts
the service signal, invokes stops in reverse actual-start order across both
groups within a shared deadline, then stops jobs/executor/database. An exclusive
start in progress is awaited before cleanup so a late-acquired resource is
also stopped; the supervisor's kill deadline still bounds shutdown. The
deadline is the maximum declared `stopTimeout`, at least 2000 ms and capped at
30000 ms (positive integer milliseconds). It is one budget for all services,
not a fresh timeout per stop. The child reports this budget before service
startup and again at readiness; the supervisor allows the budget plus 1000 ms
before SIGKILL for stop and swap cleanup. The default remains three seconds.
Retired releases first get up to three seconds to drain HTTP requests. SIGTERM
and IPC stop both run this cleanup. Crashes/forced kills cannot guarantee
cleanup. In-memory state such as terminal sessions does not survive
deploys/restarts.

Not covered: two daemons sharing a `BEDROCK_HOME` (unsupported), or a separate
`bedrock dev` running the same pebble with its own data directory. Exclusive
services govern the child process lifetime, not external subprocesses or
remote work that outlives it. Keep an application lease for stronger guarantees
on shared external resources.

`ServicesOf<typeof pebble>` derives service values; annotate
`FunctionContext<ServicesOf<typeof pebble>>` or `DetachedContext<...>` (using a
separate services definition to avoid circular inference) for checked handler
service names/results. Helper callbacks otherwise retain the open service map.

## 12. Built-in backups

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
Snapshot SQLite work, hashing, and compression run in a Bun Worker thread so
backups do not block the daemon's HTTP proxy. The database is hashed and gzipped
as a stream; disk uploads copy the staged gzip file and R2 uses bounded multipart
uploads. The checksum still covers the uncompressed SQLite bytes. Worker failures
fail the backup and remove staging files; daemon shutdown cancels active snapshots.
Filename timestamps replace ISO time colons with hyphens on every platform;
manifest timestamps and `--at` retain ISO format. Existing backup keys remain
readable and restore/pruning use the manifest's stored database key.

Retain the newest `keep` snapshots per pebble and for identity (default 24, so one
day at the default 60-minute interval), delete older DBs/manifests, and GC file
blobs unreferenced by remaining manifests. `backup.intervalMinutes` and `keep`
(`backup setup --interval-minutes <n> --keep <n>`) are stored with target
metadata; the older `hourly`/`daily` keys are ignored. The `VACUUM INTO` copy and
gzip file are staged in a `.bedrock-backup-*` directory beside the database, never in the OS
temp directory. Before staging, available space on that filesystem must cover
twice the DB + WAL size (SQLite copy and potentially incompressible gzip) plus
64 MiB. Filesystem backup targets also check object size plus 64 MiB before
each put. Insufficient space skips only that pebble (or identity), emits a
warning and retries next cycle. Run results include `{ skipped, warning }`;
`backup-state.json` stores per-pebble `warnings`, also reported by doctor.
Skipped backups do not advance their success timestamps or the full-cycle
success timestamp. Normal failure, worker exit and shutdown cancellation
terminate the worker and remove staging files. Staging directories carry the
daemon PID; a subsequent snapshot removes directories whose owner process no
longer exists before checking space (including after a killed daemon). These checks are best effort:
concurrent writers can consume available space after inspection.

Directory-backup settings come from `.bedrock-backup.json`, which
the daemon writes into a release from the child's health check, so backups do
not import pebble code into the daemon (a release not started since falls back
to loading `pebble.ts`).
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
hint points to backup restore. `bedrock --version` prints local package/checkout identity, platform and Bun; `bun
link` from packages/bedrock registers the CLI on PATH.

## 13. Trust model

Creators are trusted. Pebbles are separate processes with no OS isolation and
can access server resources as the daemon user. Security boundaries protect
against end users and the internet, not hostile creators.

## 14. Agent-friendliness (non-negotiable)

- Every CLI command supports `--json` (machine-readable output, one JSON object on stdout, except doctor returns its checks array) and is idempotent.
- Errors are typed (`BedrockError` with `code`, `message`, `hint`) — the hint says how to fix it.
- `bedrock dev` runs the full stack locally (daemon + pebble + fake auth) at `http://<pebble>.localhost:<port>`.
- The package ships the complete author guide `AGENTS.md` and a short `llms.txt` index.
- Destructive commands (`db reset`, `pebble delete`) require `--yes`.


### Testing pebbles (`bedrock test`)

`bedrock test [path] [--grep <pattern>] [--project desktop|phone] [--json]`
runs `bun test ./tests/unit` first, then `tests/e2e/**/*.spec.ts` and built-in
Chromium smoke tests. Missing unit tests are reported as skipped. Unit tests use
`startPebble({ dir, dataDir, port: 0, cron: false })` from `bedrock/server` and its
real SQLite database, executor and `jobs.run(name)`; no database mocks are supplied.
A temporary `BEDROCK_HOME` also protects runtime tests that omit `dataDir`.

Browser tooling is optional, development-only: install
`bun add --dev @playwright/test@1.64.0 @axe-core/playwright@4.14.0`, then
`bunx playwright install chromium`. Neither the daemon nor pebble runtime imports
these packages. A pebble that does not use browser tests need not install them.
There is one Chromium worker; browsers close at the end of each run. Browser
integration tests in Bedrock's own suite skip when Chromium is not installed.

Each run builds a new seed template under the system temporary directory. It
replays the pebble's committed migrations, inserts fixed daemon fixture identities
(`bedrock-test-owner`, `bedrock-test-friend`, `bedrock-test-outsider`), then calls
optional `tests/seed.ts`'s default export. The seed receives
`{ db, sqlite, dataDir, users, now }`; `now` is `2024-01-01T00:00:00.000Z`.
Use fixed application IDs and dates too. The template database is checkpointed
and closed before copying. Each browser test gets a separate copy of the daemon
identity DB, application DB and seeded files, and a fresh real dev daemon/pebble
on port 0. Source watching and cron dispatch are disabled. Shutdown precedes case
disposal. `server.runJob(name)` explicitly invokes a job through dev-worker/child
IPC. Services still start normally: provide pebble-specific substitutes for
external mail, devices or paid APIs; SQLite isolation does not isolate those.
Shell application secrets are not inherited, and no deployed data or secrets are
loaded by the harness.

Optional `bedrock.test.ts` default-exports a plain object (unknown keys fail):

```ts
import type { TestConfig } from "bedrock/testing";
export default {
  users: { owner: "me@example.test", friend: "friend@example.test" },
  pages: [{ path: "/", user: "owner", ready: '[data-testid="app-ready"]', visual: false }],
  // seed: overrides the default tests/seed.ts function
  // prepareScreenshot: async page => { ... put animated controls in a stable state ... }
} satisfies TestConfig;
```

Roles are `anonymous`, `owner`, `friend`, `outsider`; default emails are
`<role>@example.test`, and the owner is a daemon creator. Configured emails must
be distinct; use the pebble's actual allow-list addresses when necessary. Tests
can import `{ test, expect, loginAs }` from `bedrock/testing`. The exported `test`
adds `server`, `loginAs(page, role)` and separate-context `anonymous`, `owner`,
`friend`, `outsider` page fixtures. Login fills and submits the real same-origin
dev form and verifies `/_bedrock/me`; it never forges identity headers or cookies.
The default `page` remains anonymous until login. For browser API assertions use
same-origin `page.evaluate(() => fetch(...))`: Chromium resolves `*.localhost`
without host DNS, whereas Playwright's separate API request client may not.

With no `pages`, web pebbles smoke `/` as owner and, if public, anonymously.
Protected anonymous roots are explicitly skipped; declare an accessible anonymous
page to cover that state. API-only pebbles skip smoke (authored e2e specs still
run). Default readiness is the first `[data-bedrock-ready]`, `main` or
`[role="main"]`; supply a meaningful selector for apps without these or with
loading shells. A redirect to dev login never counts as application readiness.
Each declared page runs at 1280×800 and 390×844, DPR 1, locale en-US, timezone UTC
and reduced motion. Checks report readiness, zero `pageerror`/`console.error`,
axe WCAG 2.0/2.1/2.2 A/AA violations of every impact, and document-level horizontal
overflow above 1 CSS pixel. Axe `incomplete` results are listed for manual review;
a pass is not WCAG certification. Dependent checks are skipped if readiness fails.

Visual comparisons are opt-in per page (`visual: true`). They use Playwright
`toHaveScreenshot`, color-distance threshold 0.2, **zero changed pixels**, disabled
animations and hidden caret, after fonts and images settle and optional
`prepareScreenshot(page)` runs. Bundle the pebble's fonts; do not depend on remote
font availability or host fallback fonts. Canonical approval uses the home
server's Linux and pinned Playwright Chromium. Baselines live in
`tests/e2e/__screenshots__/<platform>/<project>/...`; generation requires
`--update-snapshots --yes`. Review the images before committing. Missing baselines
fail ordinary runs. Canvas/JS animation needs the app's real stable-state API in
the hook; disabled CSS animations alone cannot freeze it.

Additional options: `--list` discovers browser tests without running migrations,
seed, servers or browsers; `--headed` diagnoses; `--repeat 1..100` repeats browser
cases; `path` selects matching e2e spec paths (and omits built-in smoke).
`--grep` and `--project` select browser cases; unit tests still run first.
Retries default to zero. `--diagnostic-retry` allows one retry, preserves the
first failure, reports `flaky` if it passes, and still exits nonzero. No silent
quarantine is provided.

Exit codes: 0 pass/discovery, 1 failed checks (including flakes), 2 setup/config
failure. `--json` emits one Bedrock envelope: `{ ok: true, value: report }` or
`{ ok: false, error: { code, message, hint, data: report } }`. Report version 1
contains run ID, duration, configuration, per-check status/duration/attempts,
artifact paths and reproduction argv. Bun JUnit and Playwright JSON supply the
results; logs never mix into stdout. Logs, axe data, failure screenshots and
retained failure traces live under `.bedrock/tests/<run>/`. Completed runs older
than 7 days are removed, then oldest completed runs until below 500 MiB. Active
and current runs are preserved; retention reports an oversized current run.
Nothing is uploaded. `bedrock test --help` lists options and repair commands.

`bedrock dev` retains its source-local `.bedrock/daemon` home, `.bedrock` data,
source watching, cron and default port 3000. Its shared launcher accepts explicit
home/data directory, port 0, watch and cron switches for isolated tests.
