# Building pebbles with Bedrock

Requires Bun ≥ 1.2, TypeScript and ESM. Run everything with Bun: the package ships
TypeScript source. `pebble.ts` default-exports `definePebble(...)` and is the single
source of truth. The repository's `ARCHITECTURE.md` holds principles;
`docs/reference.md` holds implementation detail. This guide ships in the package; `llms.txt` is a short index.

## A complete pebble

Install `bedrock` and `valibot` (or another Standard Schema validator); install
`drizzle-kit` as a dev dependency. Save the following as `pebble.ts`:

```ts
import {
  definePebble, query, mutation, bucket, job, BedrockError,
  sqliteTable, text, integer, eq, desc, lt,
} from "bedrock";
import * as v from "valibot";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id").notNull(),
  body: text("body").notNull(),
  attachmentId: text("attachment_id"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});
export const attachments = bucket("attachments", {
  maxSize: "50mb", access: "owner", accept: ["image/*", "text/plain"],
});

export default definePebble({
  name: "notes", access: "users", sync: true,
  schema: { notes }, storage: [attachments],
  queries: {
    mine: query(({ db, user }) => db.select().from(notes)
      .where(eq(notes.ownerId, user!.id)).orderBy(desc(notes.createdAt))),
  },
  mutations: {
    add: mutation(v.object({ body: v.string(), attachmentId: v.optional(v.string()) }),
      async ({ db, user, storage }, { body, attachmentId }) => {
        if (attachmentId) await storage.get(attachments, attachmentId);
        return db.insert(notes).values({ ownerId: user!.id, body,
          attachmentId: attachmentId ?? null }).returning();
      }),
    remove: mutation(v.object({ id: v.string() }), ({ db, user }, { id }) => {
      const note = db.select().from(notes).where(eq(notes.id, id)).get();
      if (!note || note.ownerId !== user!.id)
        throw new BedrockError("FORBIDDEN", "You cannot remove this note.", "Choose one of your own notes.");
      return db.delete(notes).where(eq(notes.id, id)).returning();
    }),
  },
  jobs: {
    count: job("0 3 * * *", ({ db }) => { console.log(`Notes: ${db.select().from(notes).all().length}`); }),
  },
  routes: { "GET /api/health": () => new Response("ok") },
  // Add web: "./web/index.html" when you have a frontend.
});
```

Run `bedrock db generate`, commit `migrations/*.sql` (there is no `meta/`), then
`bedrock dev`. Data lives in `.bedrock/db.sqlite` and `.bedrock/files/`.
From a source install, `new`/`init` depend on `"bedrock": "link:bedrock"` (and
`"@bedrock/ui": "link:@bedrock/ui"`); the lockfile has no paths, so copies and
git worktrees just work. Never write `file:` paths; `bedrock doctor` in the
pebble flags them and prints the fix.
Dev uses a localhost daemon and a private child; the printed URL is
`http://notes.localhost:3000`. Protected pages use an email-picker login.
The default `bedrock new notes` React template includes a complete frontend, installs
dependencies, generates migrations and commits. `new --template minimal` is public
HTML; `init <name> [--template react]` scaffolds in the current empty directory.

## Production browser assets

Keep `web: "./web/index.html"` for Bun HTML entries or point it at an already-built
static directory. Deploy installs production dependencies, then builds HTML once
on the daemon host with production React, minification, split/content-hashed
assets and external maps, before starting/migrating/health-checking the candidate.
Build failure gives `WEB_BUILD_FAILED` with a repair hint; the previous release
keeps serving. Browser imports and build plugins belong in production dependencies.
`bunfig.toml`'s `[serve.static] plugins` list is shared with the build; without
that config Bedrock supplies its single-React plugin. If you have your own config,
include `"bedrock/bundler"` so `bedrock/react` and `@bedrock/ui` share your React.
Keep module-scope configuration imports free of side effects: build discovery
imports `pebble.ts` in a separate process with the pebble's secrets.

Only `.bedrock-web/public/` is served. Maps stay in private
`.bedrock-web/maps/` beside an internal manifest, per release. JS has no public
map comment; map paths and the internal directory return 404. Do not create
custom routes exposing these files. Three retained releases keep matching maps;
restart and rollback reuse the build. HTML uses `no-cache`; hashed assets are
immutable and weak ETags support 304s. Previous-release hashed assets remain
available for stale tabs; release headers and safe reload behavior still apply.

Static directories keep their existing URLs and already-built content. Supplied
external/inline JS and CSS maps move to private storage and map comments are
removed. Ship maps with your static build if later symbolication needs original
source: Bedrock cannot reconstruct mappings from a map-less bundle.
`bedrock dev` and `bedrock test` continue using the live bundler/HMR and ignore
production artifacts. Old deployed releases retain their old serving behavior
until redeployed. No extra author configuration or runtime dependency is needed.

## Idle lifecycle

Production pebbles without background work may sleep after 15 quiet minutes.
`bedrock status`, the API and dashboard show `idle`, with no child process. The
next HTTP request, WebSocket upgrade or daemon operation needing the child waits
for a shared, health-checked start. Idle pebbles remain asleep across daemon
restarts. Explicitly stopped pebbles stay stopped until started. Deploy/rollback
and secrets changes with `--restart` still start a replacement normally. Backups
work without waking the pebble. `bedrock dev` never sleeps.

On Linux with delegated cgroup v2 memory support and enough free swap, a quiet
running pebble may instead be hibernated after 15 minutes: anonymous memory moves
to swap (compressed when the host provides compressed swap). The process, jobs,
services and timers keep running, and live state survives. The first request
after a long quiet period can take tens of milliseconds as pages fault back.
There is nothing to configure. Development mode never hibernates.

**In-memory state and caches disappear on sleep.** Keep durable state in SQLite
or files. Any declared `job` or `service`, including an exclusive service, keeps
the process awake: use a job for scheduled work and a service for continuous
background resources. Do not use a dummy service just to retain a cache or hide
background loops at module scope. No keep-awake option is needed.

Open sync/application WebSockets, active HTTP uploads/response streams, queued
and detached work, IPC calls and unexpired resumable uploads prevent sleep.
Because Bun cannot reliably enumerate live timers/handles, the daemon also
conservatively scans server source and local imports. Timer/network/process or
dynamic APIs and unknown dependencies keep it running, including uses inside
handlers or comments; only `bedrock` and `node:path`/`path` external imports are
trusted. This heuristic favors leaving uncertain code awake. Do not rely on the
heuristic to declare background work: model it as a job or service.

## Configuration and functions

`definePebble` fields:

| Field | Meaning |
| --- | --- |
| `name` | 1–32 lowercase letters, digits, hyphens; start/end with a letter or digit; `auth`, `bedrock`, `www` reserved |
| `access` | `"public"` (default), `"users"`, `"creators"`, or `{ allow: ["a@x.com", "@company.com", "creators"] }` (`"creators"` admits the server's creators) |
| `schema` | Named Drizzle SQLite tables; `_bedrock_` SQL names reserved |
| `queries`, `mutations` | Maps of named `query(...)` / `mutation(...)` definitions |
| `storage` | Array of standalone registered bucket objects |
| `sync` | `true` enables reactive WebSocket subscriptions |
| `tokens` | `true` enables per-user pebble bearer tokens; disabled by default |
| `web` | Bun HTML entry path, or static directory, relative to pebble directory |
| `routes` | Bun handlers keyed by `"METHOD /path"`; `/_bedrock/` reserved |
| `sockets` | Application `socket({ open?, message, close?, drain? })` handlers by absolute path |
| `services` | Long-lived `service({ start, stop?, stopTimeout?, exclusive? })` definitions by unique name |
| `backup` | `{ directories: ["workspaces"], exclude?: ["**/node_modules/**"] }` |
| `jobs` | Map of `job(cron, handler)` definitions |

`query(fn)`, `query(standardSchema, fn)`, `mutation(fn)`,
`mutation(standardSchema, fn)`, and `mutation({ args, idempotencyKey?, run })` retain argument/result types. Standard Schema v1
validation may be async and transform input. Function names start with a letter,
then letters/digits/underscores; prototype names are rejected. Results must be
JSON-serializable: Dates cross the wire as strings, `undefined` becomes `null`.

Handlers receive `FunctionContext`:

```ts
{ db, user, token, tokens, pebble, storage, request, invalidate, services }
```

`db` is Drizzle over `bun:sqlite`; builders/operators are re-exported from
`bedrock`. `user` is `{ id, email?, name?, avatarUrl? } | null`. `pebble.name` is
read-only metadata. `request` is the incoming Request (jobs use a synthetic one).
`invalidate(tables: readonly (string | SQLiteTable)[]): void` adds registered
Drizzle table objects or SQL table names to post-commit sync notifications. Prefer
`ctx.invalidate([notes])` over `ctx.invalidate(["notes"])`; unknown names throw
`BedrockError("UNKNOWN_TABLE", message, hint)`.

Queries run inside read-only transactions. Mutations, and by default jobs and custom routes, run
inside write transactions, serialized within a process. Throwing rolls back SQL
and storage effects; errors become `BedrockError(code, message, hint)`. Middleware
executes inside the same transaction. Each call is one slot of the pebble's
serialized queue, so slow work inside it delays every other database request.
A slot longer than `BEDROCK_SLOW_SLOT_MS` (default 200 ms) logs one warning with
its kind, name and duration (plus `commit N ms` when the commit dominated);
repeats of the same name are summarized once a minute. In `bedrock dev`, in tests, and in production with
`BEDROCK_STRICT_SLOTS=1`, `fetch()` inside a slot throws `NETWORK_IN_SLOT` and
the slot rolls back. Move the fetch to a detached route, a detached job or a
service, then use `ctx.write` for the database part (see Detached routes and
jobs). Do not open nested transactions or schedule
detached writes after your handler returns. External network side effects cannot
be rolled back with SQLite.

Pebble commits normally leave WAL checkpointing to a short-lived Bun Worker at
about 1,000 pages. There is no checkpoint option. Readers and `VACUUM INTO`
backups can postpone progress: at 64 MiB of sampled WAL, the next write waits up
to 5 seconds for a checkpoint, then fails with `DATABASE_WAL_BUSY` if a held
reader still blocks it; finish held readers and retry. The limit allows one
polling interval and one transaction of overshoot. Raw `db.$client` SQL inside
queue slots shares this protection; standalone scripts must yield between short
batches and avoid held readers. Manual `PRAGMA wal_checkpoint(TRUNCATE)` still
works. A `DATABASE_CHECKPOINT_FAILED` warning means SQLite auto-checkpoint was
restored, so commits may pause again. Fix the reported cause; retries start after
30 seconds and double to a 10-minute cap without repeated failure warnings. A
successfully completed Worker restores background checkpointing and logs
`DATABASE_CHECKPOINT_RECOVERED` once. Close/shutdown cancels retries. On SQLite
3.7.0–3.51.2 (except patched 3.44.x ≥ 3.44.6 and 3.50.x ≥ 3.50.7),
`DATABASE_CHECKPOINT_UNSAFE_SQLITE` warns once per open: background Workers,
including the final shutdown Worker, are disabled to avoid SQLite’s WAL-reset
corruption bug. Upgrade Bun / use a build with newer SQLite (macOS may use
system SQLite). Auto-checkpoint remains enabled. The admission backstop still
applies in both fallback modes, using the writer for a non-waiting checkpoint
inside its queue slot. Read-only backup sources (`VACUUM INTO` writes a separate
file) remain supported. Overlapping release deploy/restart/rollback is refused on
vulnerable builds (`DATABASE_UNSAFE_SQLITE`); upgrade or stop the pebble first.
Local `db plan`/`db migrate` require a fixed build because a dev process may own
the same file. Avoid concurrent external SQL writers/checkpointers on old SQLite. For
commit-dominated slow slots, check SQLite locks, WAL reuse, storage contention and
these fallback warnings; a faster disk alone may not help. Shutdown attempts a
bounded final checkpoint; after a crash or cancelled checkpoint, keep the
`db.sqlite` and `db.sqlite-wal` files together for recovery. `bedrock dev` uses the
same checkpoint and shutdown behavior.

HTTP: `POST /_bedrock/q/<name>` or `POST /_bedrock/m/<name>`, with JSON arguments
(`null` without args), gives `{ ok: true, value }` or
`{ ok: false, error: { code, message, hint, data? } }` with the status from [Errors](#errors).

### Idempotency

A mutation sent with an idempotency key runs at most once per key for 24 h. The
retry gets the stored value back. The handler does not run again, nothing is
invalidated and no subscription re-runs.

- HTTP: header `Idempotency-Key: <key>`. WebSocket: field `idempotencyKey` on the
  `mut` message. Keys are 1–255 visible ASCII characters; otherwise
  `INVALID_IDEMPOTENCY_KEY` (400).
- Reusing a key with different args fails with `IDEMPOTENCY_KEY_REUSED` (409).
  Keys are scoped per mutation and per caller (pebble token, else user, else anonymous).
- A failed mutation stores nothing, so a retry runs it again.
- To dedupe calls the client cannot retry for you (a form resubmitted after a reload),
  derive the key from the args. A transport key wins over this one:

```ts
send: mutation({
  args: v.object({ requestId: v.string(), body: v.string() }),
  idempotencyKey: args => args.requestId, // null/undefined = no key
  run: ({ db }, { body }) => db.insert(messages).values({ body }).returning(),
}),
```

`client.mutate()` sends a fresh `crypto.randomUUID()` key with every call and
retries a lost result automatically (see [Browser client and React](#browser-client-and-react)).

### Errors

Throw `new BedrockError(code, message, hint, detail?, { status?, data? })` for
expected failures. `data` is JSON context for the client (`error.data`);
unserializable data (cycles, BigInt) is dropped with a warning, never a 500.

The HTTP status (also `status` on WebSocket error frames) is, first match wins:
an explicit `status` from 400–599; Bedrock's own codes (`UNAUTHENTICATED` 401,
`FORBIDDEN` 403, `PEBBLE_STOPPED` 503, programming faults such as `READ_ONLY` 500, …);
`NOT_FOUND`/`*_NOT_FOUND` 404; `CONFLICT`/`*_CONFLICT` 409; `RATE_LIMITED` 429;
`INVALID_*` 400; any other `BedrockError` you throw 400. A plain `Error` or other
non-Bedrock throw becomes `FUNCTION_FAILED`/`INTERNAL_ERROR` with 500. Client and
React hook errors are `BedrockError`s carrying the same `data` and `status`.

```ts
// 01:30 happens twice when clocks go back; let the user pick a reading.
throw new BedrockError("TIME_CONFLICT", "This local time is ambiguous.",
  "Choose the earlier or later reading.", undefined,
  { data: { candidates: ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"] } }); // 409

const { mutate, error } = useMutation("schedule");
error?.data; // { candidates: [...] }; error?.status === 409
```

## Schema and migrations

The migration baseline is the `migrations/*.sql` files themselves; there is no
`meta/` folder (delete an old one, Bedrock ignores it). `bedrock db generate [name]`
replays every SQL file into a scratch database, diffs the result with the
pebble's registered schema (including imported tables not separately exported from
`pebble.ts`), and writes `migrations/<UTC YYYYMMDDHHMMSS>_<name>.sql`, or nothing when
the schema is unchanged. Timestamped names let two branches add migrations without
conflicts. Commit `migrations/*.sql` and run `bedrock db check` before you commit or
deploy: it fails when the files no longer replay (for example, two merged branches
added the same column; the error names the file) or when the schema changed
without a migration. `bedrock dev` warns about both at startup.

Generate refuses to drop columns unless you pass `--allow-data-loss`, refuses a new
NOT NULL column on an existing table without `.default(...)` (`$defaultFn` is not a
SQL default), and refuses a table that both loses and gains columns, because a rename looks like a drop plus an
add. For renames and backfills run `bedrock db new <name>` and write the SQL
(`ALTER TABLE notes RENAME COLUMN body TO text;`) by hand. Tables in the migrations
but not in `schema` (FTS, raw-SQL tables) are left alone; to drop a schema table,
remove it and write `DROP TABLE` with `db new`. Changes SQLite cannot `ALTER`
rebuild the table; a generated rebuild starts with `PRAGMA foreign_keys=OFF`, which
the runner honours outside the transaction, then checks foreign keys before commit.
Rebuilds drop the table's triggers, so recreate them in the same migration.

`bedrock db plan` previews pending SQL; `bedrock db migrate` applies it locally.
Dev/deploy apply migrations automatically. Never edit applied SQL: checksums are
recorded in `_bedrock_migrations`. Put each schema change in a new migration.
Bedrock owns migration transaction boundaries.

Deploy archives exclude `node_modules`, `.bedrock`, `.git`, `._*`, `.DS_Store`,
`.env` and `.env.*` at every depth, plus the archive itself. `.envoy/` and
`.environment` remain included. Git ignore rules are **not** applied: ignored
web/build output still ships. Use `bedrock deploy <clean-export-dir>` to ship less.
Scratch trees otherwise ship; compressed archives over 50 MB warn with the five
largest top-level directories and their uncompressed sizes (metadata only, no
symlink traversal). Dirty Git trees, including untracked files, also warn.
Human output prints warnings; JSON deploy output has `warnings: string[]` and
remains one value on stdout. Releases report `provenance: { commit, branch,
dirty }` in deploy/lifecycle/list/status responses, retained after daemon restarts
and rollback to describe the selected release. Missing Git, non-repositories and
older releases have null provenance fields; detached HEAD has a null branch.
Older clients/daemons continue deploying, but older daemons do not retain provenance.

Deploy keeps the last three code releases. `bedrock rollback notes` switches code,
not data; it refuses a target missing applied migrations. `--force` bypasses the
check when you have established compatibility. Restore a matching backup for
schema recovery; restarting the current code applies its pending migrations.

Custom HTTP routes may set `definePebble({ maxRequestBodySize: bytes })` (positive integer, default 90 MiB, maximum 1 TiB). The daemon ceiling is 1 TiB and forwards request bodies as streams; custom routes must stream them to bound memory. Storage bucket limits remain separate. Application sockets retain the original URL and headers before upgrade, including on Bun 1.2.

### Detached routes and jobs

Use `detached(handler)` for a route and `job(cron, handler, { transaction: false })`
for a job that awaits slow network I/O. Import both helpers from `bedrock`.
Existing handlers remain transactional by default.

```ts
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

`DetachedContext` has `{ user, token, pebble, request, read, write, services }`. Direct `db`,
`storage`, and `invalidate` access throws `BedrockError` with a read/write hint.
`read(fn)` is a queued read-only transaction; `write(fn)` is a queued write
transaction with storage effects and sync notification after commit. Callbacks
receive `FunctionContext` and resolve their returned value. Await every slot and never retain its context or
perform slow network I/O inside it. A failed write rolls back only that slot;
earlier committed slots survive a later handler error. Route access gating and
identity stay the same; jobs retain `user: null`, scheduling, manual CLI runs,
and process-local overlap protection.

## Authentication, authorization and trust

Google OAuth and sessions belong to the daemon; identity is global, access is per
pebble. Configure Google's redirect URI as `https://auth.<domain>/callback`.
The daemon checks access before normal pebble routes and strips external identity
headers/session cookies. Each child receives a separately derived signing secret;
functions and sync verify signed identity too. The child also checks access for normal custom routes, including anonymous
requests; expose pebbles through the daemon, not their child port.

`"users"` permits all signed-in users, not only row owners. Queries and mutations
must enforce row authorization explicitly (e.g. filter `ownerId` and check it
before update/delete). Creators are configured on the server. Public handlers
must handle `user === null`. Jobs always have `user: null` and bypass pebble access
checks; they are trusted server code. Bucket access still applies in jobs.

Session/browser writes and WebSocket upgrades require the exact pebble Origin. Browser
clients supply cookies/Origin automatically. Non-browser calls without a pebble bearer must
provide Origin; use the SDK for normal requests. A signed-in account refused by a
pebble's access gets a 403 page with a "Sign out and switch account" button; you
need not build one. Daemon errors, 404 and stopped-pebble 503 responses are
styled HTML for browser navigations and JSON/text otherwise; your own route errors are unchanged. Logout closes the session's
sockets; expiry/revocation is checked periodically. WebSocket traffic alone does
not slide the 30-day session expiry.

Creators and their code are trusted. Pebbles have no OS isolation and can access
server files as the daemon user. Security boundaries protect against end users
and the internet, not hostile creators. Unscoped deploy tokens grant full daemon management; scoped tokens grant only named actions on matching pebble globs.


### Public HTTP routes

Use `publicRoute` from `bedrock` for anonymous HTTP endpoints on a protected
pebble. It composes with detached work:

```ts
routes: {
  "GET /agents.md": publicRoute(() => new Response(doc, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  })),
  "GET /health": publicRoute(detached(() => new Response("ok"))),
}
```

Only HTTP entries in `routes` qualify; sockets, functions and storage cannot be
marked public, and public wildcard (`*`) keys are rejected. Public keys must
use normalized paths without repeated slashes or dot segments. It is allowed and
redundant on `access: "public"`. The daemon matches normalized paths by exact,
case-sensitive segments; `:param` matches one nonempty segment. Extra/trailing
slashes and encoded static spellings do not match. HEAD can fall back to GET.
The child checks the actual selected handler, so private static/HEAD overrides
still deny anonymous access. Reserved `/_bedrock` paths never qualify. Protected
pebbles with a Bun HTML entry must namespace public GET/HEAD parameter routes:
root patterns like `/:id` are rejected at load because generated bundle assets
would override their handlers. Static public paths such as `/agents.md` work.

These handlers always see `user: null` and `token: null`, even when callers send
valid credentials. The daemon skips session resolution, Origin checks and login
redirects, removes all Cookie, Authorization and x-bedrock-* headers, and sends
no identity; the child repeats credential stripping. Public routes need no token
grant, but `route:<exact key>` remains a valid registered token permission.
Deploy output and `bedrock ls` list public routes (JSON: `public_routes`), including
stopped releases.

Author security checklist:

- Treat every input as untrusted; never return user data or secrets.
- Bound request size and work yourself. There is no built-in rate limit.
- Never call paid upstreams on anonymous input.
- Prefer GET for static documentation and health responses.
- Keep anything private on normal routes.

### Pebble tokens for native clients

Enable `tokens: true`. Create tokens through a browser-authenticated mutation;
return the raw value once and save it securely. Deploy tokens must never be used
for pebble uploads. For example, save this as `pebble.ts`:

```ts
import { definePebble, mutation, bucket } from "bedrock";
const uploads = bucket("uploads", { maxSize: "50mb", access: "owner" });
export default definePebble({
  name: "uploads", access: "users", tokens: true, storage: [uploads],
  mutations: {
    createUploadToken: mutation(ctx => ctx.tokens.create({
      name: "ShareX", permissions: ["route:POST /api/upload"],
    })),
  },
  queries: {},
  routes: { "POST /api/upload": async (request, _server, ctx) => {
    const file = await ctx.storage.put(uploads, request.body!, {
      name: request.headers.get("x-filename") ?? "upload",
      mime: request.headers.get("content-type") ?? "application/octet-stream",
    });
    return Response.json(file, { status: 201 });
  } },
});
```

Call `createUploadToken` from your signed-in browser; use the returned `token`:

```sh
curl https://uploads.example.com/api/upload \
  -H "Authorization: Bearer $PEBBLE_TOKEN" \
  -H "Content-Type: image/png" -H "X-Filename: screenshot.png" \
  --data-binary @screenshot.png
```

`ctx.tokens.list()` returns only your non-revoked metadata. Create/revoke require
write slots and participate in the transaction; token callers cannot mint tokens
or revoke another user's token. Disabled APIs throw `TOKENS_DISABLED`.
`ctx.token` (also on detached contexts) is `{ id, name, permissions, effective,
profiles, metadata }` or null; jobs always get null. Expiry is an optional future
Unix millisecond timestamp.

Permissions default to deny: `*`, `query:<name>`, `mutation:<name>`,
`route:<exact METHOD /path-pattern>`, `socket:<registered /path>`,
`files:<bucket>:upload|read|delete`, and `profile:<name>`.

Prefer profiles for tokens a client keeps for a long time, so new operations do
not require re-minting:

```ts
export default definePebble({
  name: "chrono", access: "users",
  tokens: { profiles: { device: ["query:entries", "mutation:track"] } },
  mutations: {
    pairDevice: mutation(ctx => ctx.tokens.create({
      name: "Phone", permissions: ["profile:device"], metadata: { kind: "device" },
    })),
  },
  // ...
});
```

Profiles expand from the running config on every request: add an operation to
`device` and deploy, and every existing `profile:device` token can call it.
Profile entries must be registered explicit permissions (no `*`, no nested
`profile:`), and names match `^[a-z][a-z0-9-]{0,47}$`; mistakes fail at load with
`INVALID_TOKEN_PROFILE`. Authorize with `ctx.token.effective`; `permissions` stays
the stored grants. A profile removed from config grants nothing and appears in
`ctx.tokens.list()` as `unknownProfiles`. Use `metadata` (≤32 string values, ≤4 KB
JSON, else `INVALID_TOKEN_METADATA`) to label a token's kind instead of guessing
from its permissions; it is returned by `list()` and on `ctx.token`.
Targets must exist in the registered maps. Chunk operations require upload,
and WS sync requires `*`. Grants supplement user, row, and bucket authorization;
current pebble access policies still apply to the stored user snapshot. Invalid,
expired, or revoked tokens return JSON 401 with a new-token hint.

Native bearer calls without a session cookie need no Origin. Any session cookie
keeps the normal CSRF rules and suppresses bearer authentication; signed identity
wins. Browser extensions needing cross-origin CORS are not yet supported.
`createClient<typeof pebble>({ url, token, sync: false })` sends Authorization and
omits cookies for function/storage calls. Bun supports token WebSockets through
headers; browser token clients use HTTP polling because browser WebSockets
cannot set Authorization. `fileUrl()` returns a URL only; download it with a
bearer-authenticated fetch rather than embedding it as a browser image URL.

## Live queries and explicit invalidation

With `sync: true`, tracked Drizzle reads establish table read-sets. Committed writes
invalidate matching subscriptions; reruns use each subscriber's own user, debounce
for ~16 ms, and suppress identical results. Trigger/cascade effects are tracked
conservatively. Reads through `db.$client` bypass tracking; prefer Drizzle queries.
Writes through `ctx.db` in mutations, jobs, and routes are tracked automatically.
Explicit invalidation is only needed for raw SQL via `$client` or writes outside
bedrock; include affected tables for triggers/cascades. For external writes,
notify from a mutation, route, or job. Invalidation is emitted only on successful
commit.

```ts
routes: {
  "POST /api/prune": (_request, _server, ctx) => {
    ctx.db.delete(notes).where(lt(notes.createdAt, Date.now() - 30 * 86400000)).run();
    return Response.json({ ok: true });
  },
},
jobs: {
  prune: job("0 3 * * *", ctx => {
    ctx.db.delete(notes).where(lt(notes.createdAt, Date.now() - 30 * 86400000)).run();
  }),
},
```

The raw SQL escape hatch still needs explicit invalidation:

```ts
ctx.db.$client.exec("UPDATE notes SET body = trim(body)");
ctx.invalidate([notes]);
```

Custom routes keep `(request, server)` working and add context as the third
argument. They return Response/Promise<Response>. By default they run in a write transaction
(even GET); keep them short and use function APIs for normal app data.

## Storage

```ts
const attachments = bucket("attachments", {
  maxSize: "50mb", access: "owner", accept: ["image/*"],
});
// definePebble({ storage: [attachments], ... })
```

Names use `[a-z0-9_-]{1,32}` and must be unique. `maxSize` accepts bytes or a size
string. Access: `"public"`, `"users"`, `"owner"`, or async
`(ctx, fileMetadata) => boolean`. Anonymous jobs need a policy that permits their
operation; an owner bucket requires a user. Owners may delete their own files;
other deletion requires a custom policy. Register the exact bucket object.

```ts
const file = await ctx.storage.put(attachments, new Blob(["hello"]), { name: "hello.txt", mime: "text/plain" });
const blob = await ctx.storage.get(attachments, file.id);
const files = await ctx.storage.list(attachments, { limit: 100 });
await ctx.storage.delete(attachments, file.id);
```

Omit optional properties rather than setting them to `undefined` under strict
optional-property types. `put` accepts Blob/ReadableStream and returns FileMetadata;
`get` returns Blob; `list` returns metadata with optional `ownerId`, `limit` (1–1000),
`cursor`. Metadata: `id, bucket, ownerId, name, mime, size, sha256, createdAt`.
Writes require a mutation, route, or job and roll back with the SQL transaction.
Verify an owner-bucket attachment with `get` before linking its id to a row.

HTTP: POST `/_bedrock/files/<bucket>`; GET/HEAD/DELETE
`/_bedrock/files/<bucket>/<id>`. Downloads enforce access, support Range and safe
content headers. The SDK chunks uploads above 90 MiB transparently. Metadata is
in `_bedrock_files`; local files are `data/files/<bucket>/<id>`. Synced storage
list queries rerun after committed upload/delete operations.

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
Chunk status (`GET .../uploads/<uid>`) and cancellation (`DELETE .../uploads/<uid>`) require upload permission too, rather than file delete permission.
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
chunks, with the same user/bucket authorization. `DELETE .../uploads/<uid>`
uses that same authorization, waits for active chunk writes through the per-upload
serialization lock, and removes the manifest and all chunk files. Success is 204;
a repeat, expired handle, or already-completed upload returns 404
`UPLOAD_NOT_FOUND`. Completion and cancellation share the lock: if completion wins,
the committed file remains; if cancellation wins, completion returns 404 and no
file is created. Cancellation never removes completed files or another user's
upload. `POST .../uploads/<uid>/complete`
accepts no body or `{ sha256 }`. Digests are lowercase hex SHA-256; if declared at
start or completion, each must match the assembled bytes or completion throws
`UPLOAD_CHECKSUM_MISMATCH`. Size is always verified. Upload state expires after
24 hours and survives restarts.

## Jobs

```ts
import { job, lt } from "bedrock";
// inside definePebble:
jobs: { prune: job("0 3 * * *", async ctx => {
  ctx.db.delete(notes).where(lt(notes.createdAt, Date.now() - 30 * 86400000)).run();
}) },
```

Cron has five fields: minute (0–59), hour (0–23), day (1–31), month (1–12), weekday
(0–7, 0/7 Sunday). Supports numbers, `*`, comma lists, inclusive ranges, `/steps`;
`5/20` means 5,25,45. Uses local server time. If both day and weekday are restricted,
either matching is sufficient (traditional cron). No named weekdays/months,
seconds field or catch-up. The daemon persists execution history and expected deadlines. Each process schedules
once per observed minute; skipped minutes are not replayed. DST follows the local
clock: missing local minutes are skipped and repeated local minutes can run twice.

By default a job executes inside a write transaction with `user: null`, logs failures with
its name, and automatically tracks Drizzle writes for sync after commit. No
`invalidate()` call is needed for these writes. Overlapping runs of the same job are
skipped (manual or scheduled); different jobs queue through the executor.

```sh
bedrock jobs ls notes --json
bedrock jobs run notes prune --json
bedrock jobs history notes --json
```

These use creator-authorized daemon APIs. The daemon sends `jobs.list` and
`jobs.run` (with `{ name }`) over child IPC, using `{ op, requestId, ...payload }`.
Replies are `{ op: "reply", requestId, value | error }`; stop is `{ op: "stop" }`
without a reply. Service-token operations use the same channel. Unknown
`/_bedrock/*` HTTP paths return the JSON 404; jobs have no HTTP control route.

## Composition

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

## Application sockets and long-lived services

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
returns the awaited start value through `ctx.services` in function, route,
socket and job contexts. ServiceContext is `{ pebble, dataDir, read, write, log,
signal }`, with no lifetime transaction. Use `write` for raw SQL invalidation.

Use `exclusive: true` for a service that owns a port, browser profile, lock or
upstream sync:

```ts
services: {
  browser: service({
    exclusive: true,
    start(ctx) { return openBrowserProfile(ctx.dataDir); },
    stop(browser) { return browser.close(); },
  }),
}
```

Non-exclusive services start first, in map declaration order, before HTTP and
health readiness. Exclusive services then start in their declaration order,
after the previous child exits. Non-exclusive services must not depend on
exclusive values; exclusive services can use earlier values through
`ctx.read`/`ctx.write` contexts. Standalone `startPebble` (including test suites)
starts both groups immediately before returning.

Within one daemon, exclusive services never run in two releases of one pebble
at once, across deploy, rollback, restart, crash restart and daemon stop/start.
There is a gap from old stop through new startup; HTTP, sockets and ordinary
services retain the zero-downtime swap. Handlers touching an exclusive service
during the gap get `SERVICE_NOT_STARTED` with a retry/logs hint. See the
[reference measurement](../../docs/reference.md#11-application-sockets-and-long-lived-services)
for the trivial handoff cost; your service startup adds to that gap.

Deploy, rollback and restart results report
`exclusive_services: "none" | "running" | "failed"`. A thrown start reports
`SERVICE_START_FAILED`. Failed exclusive startup
unwinds the exclusive services already started, then the child gracefully stops
and exits non-zero; normal crash backoff retries it, marking it `crashed` after
five failures, then retrying indefinitely every 4.5–5 minutes. The replacement
is already selected. CLI warnings point
to `bedrock logs <name>` (stderr, including with `--json`). Failed startup before
activation still leaves the previous release serving. Secrets `--restart`
also returns the exclusive-service result.

Stopping closes the listener, sends 1012 "Service restart" to sockets, aborts
the service signal, and stops services in reverse actual-start order, across
both groups. An in-progress exclusive start is awaited for cleanup; the
supervisor can still force-kill it. The shared deadline is the maximum declared
`stopTimeout`, at least 2000 ms and capped at 30000 ms (positive integer
milliseconds), followed by 1000 ms before SIGKILL. Retired releases first get
up to three seconds to drain HTTP. Startup failures before readiness unwind
started services too. SIGTERM and IPC stop run cleanup; crashes/forced kills
cannot guarantee it. In-memory state does not survive deploys/restarts.

Two daemons sharing `BEDROCK_HOME` (unsupported) and a separate `bedrock dev`
with its own data directory are not covered. Subprocesses and remote work that
outlive the child need an application lease for stronger shared-resource
guarantees.

`ServicesOf<typeof pebble>` derives service values; annotate
`FunctionContext<ServicesOf<typeof pebble>>` or `DetachedContext<...>` (using a
separate services definition to avoid circular inference) for checked handler
service names/results. Helper callbacks otherwise retain the open service map.

## Browser client and React

Keep server definitions out of browser bundles by importing the pebble **as a type**:

```ts
import { createClient } from "bedrock/client";
import type pebble from "../pebble";
const client = createClient<typeof pebble>();
const notes = await client.query("mine", undefined);
const result = await client.mutate("add", { body: "Hello" });
const unsubscribe = client.subscribe("mine", undefined, rows => console.log(rows), error => console.error(error.hint));
const file = await client.upload("attachments", new File(["hello"], "hello.txt", { type: "text/plain" }));
const url = client.fileUrl("attachments", file.id);
await client.deleteFile("attachments", file.id);
unsubscribe();
client.close();
```

The client accepts `{ url?, sync?, pollInterval?, headers?, token?, autoReload?, beforeReload?, errors? }`; url defaults to browser origin.
Pass an absolute URL outside the browser. `sync: false` uses HTTP; without server
sync, subscriptions poll every 5 seconds (`pollInterval: 0` disables polling). Connections reconnect and resubscribe
with backoff. A mutation whose result is lost (`CONNECTION_LOST`, `MUTATION_TIMEOUT`, or no HTTP
response) is retried with the same [idempotency key](#idempotency), up to 3 attempts in total. Upload options
include `onProgress` (0–1), `signal`, `meta`, `uploadId`, and `onUploadId`.
Browsers report byte progress via XHR; Bun uses fetch boundary progress. Chunked
uploads hash incrementally and resume missing chunks with a saved upload id.
`client.cancelUpload(bucket, uploadId)` explicitly removes an unfinished upload,
accepting `UPLOAD_NOT_FOUND` as already gone for safe retries. An explicit signal
abort with a known upload id sends cancellation using a separate, non-aborted
signal (10-second timeout); cleanup failures preserve the original transfer error.
If offline, retry cancelUpload with the saved id later. Transient request failures
preserve manifests/chunks for resume and never automatically cancel. A completion
that won the cancellation race remains a completed file. Client methods take bucket **names**, not
server objects. `user()` returns User|null, `loginUrl(returnTo?)` gives a login URL,
`logout()` signs out. Use ordinary browser cookies, not signed identity headers.

`connection()` returns `{ state, since, attempt }`; state is idle, connecting, live,
reconnecting, polling, or offline. `onConnection(fn)` observes only state changes
and returns unsubscribe (no immediate call). Only the runtime's NOT_FOUND 404
permanently disables sockets; transient failures poll while retrying sockets.
`mutate()` delivers changed same-client subscription data before resolving over
WS or HTTP. `fetch(path, init?)` calls same-origin custom routes with client auth,
observes release headers and blocks stale reload while in flight. HTTP errors
return the Response; network failures throw REQUEST_FAILED. Successful writes
refresh subscriptions before returning while polling. `user()` network failures
throw OFFLINE; a null user is a definitive server answer.

`release()` returns `{ page, server, stale }` (unknown ids are `null`);
`onRelease(fn)` observes changes and returns an unsubscribe function. `useRelease()`
returns the same state. Non-token browser clients silently reload stale pages by
default when mutations/custom requests/uploads have settled and focus is not editable (or the tab
is hidden). Set `autoReload: false` to disable this, or return `false` from
`beforeReload` to postpone until the next safety check. Reloads preserve form fields
and scroll for 30 seconds on the same URL; password/file/hidden inputs are excluded.
For dirty editor state, keep the veto true for as long as needed, including
hidden tabs. There is no forced timeout:

```ts
const client = createClient({ beforeReload: () => !editor.hasUnsavedChanges() });
// Or autoReload: false; observe client.onRelease and let the app reload manually.
```

The callback is synchronous and rechecked on the next safety event/request
settlement. Saving can issue a client mutation/fetch to trigger that recheck;
applications that need complete control should use autoReload: false.

Add `id` and `data-bedrock-keep-scroll` to preserve an element's vertical scroll.
Reloads are limited to once per 10 seconds per tab. Returning from pagehide, going
online, or making the tab visible reconnects immediately; service restarts retry
within 100–1000 ms. Call `close()` to remove listeners and stop reconnecting.

```tsx
import { createRoot } from "react-dom/client";
import { createClient } from "bedrock/client";
import { BedrockProvider, useQuery, useMutation, useUser, useUpload, useRelease } from "bedrock/react";
import { AppShell, UserMenu, SignInGate, Button } from "@bedrock/ui";
import "@bedrock/ui/styles.css";
import type pebble from "../pebble";
const client = createClient<typeof pebble>();
function Notes() {
  const { data, isLoading, error } = useQuery<typeof pebble>("mine", undefined);
  const { mutate, isPending } = useMutation<typeof pebble>("add");
  return <><Button disabled={isPending} onClick={() => { void mutate({ body: "Hello" }); }}>Add</Button>
    {isLoading ? "Loading…" : error ? error.message : data?.map(note => <p key={note.id}>{note.body}</p>)}</>;
}
createRoot(document.getElementById("root")!).render(
  <BedrockProvider client={client}><AppShell name="Notes" userMenu={<UserMenu client={client} />}>
    <SignInGate client={client}><Notes /></SignInGate>
  </AppShell></BedrockProvider>,
);
```

All hooks need BedrockProvider. `useQuery` returns `{ data, error, isLoading, connection }`;
`useMutation` returns `{ mutate, error, isPending }`; `useUser` returns
`{ user, isLoading, error, retry }`; errors preserve the last user and retry with backoff.
`useConnection()` returns the client connection state. `useUpload<typeof pebble>("attachments")` returns
`{ upload, progress, error, isUploading }` and passes all upload options through. Args without a schema are `undefined`.
HTML references `./app.tsx` with a module script; Bun bundles it. Keep `react` and
`react-dom` in the pebble's dependencies: Bedrock's `bedrock/bundler` plugin makes
`bedrock/react`, `@bedrock/ui` and Onyx use that one copy in dev and in releases.
No setup is needed unless the pebble has its own `bunfig.toml`; then list
`"bedrock/bundler"` in its `[serve.static] plugins` (`bedrock doctor` checks this).

`@bedrock/ui` exports every Onyx primitive (forms such as Field, Input, Select,
Combobox and DatePicker; overlays such as Dialog, Sheet, Menu, Popover, Tooltip
and Command; collections such as Listbox, Tree, VirtualList and Table; layout
such as Stack, Panel, Toolbar and SplitView) and AppShell, UserMenu, SignInGate,
UploadButton. Import its stylesheet once; no Tailwind setup is needed.
`UploadButton<typeof pebble>` takes `bucket="attachments"` and
`onUpload={metadata => ...}`, with optional `accept`, `disabled`, `label`,
`onError`, `onUploadingChange`. It uploads immediately; link the returned id in
a mutation and clean up abandoned files. Pass the provider's client to auth UI.
Set `document.documentElement.dataset.theme` to `"light"` or `"dark"`; use normal
CSS for app layouts. `OnyxThemeRoot` also accepts a scoped `theme`, `density`,
and semantic `variables`; an omitted theme inherits its surroundings. The bundled
CSS includes utilities used by components only, all Onyx component layers, and
the embedded codicon font. Upstream palettes and defaults come from Onyx.
Select options follow the trigger’s computed font size, family, weight, line
height, and letter spacing across the portal; explicit SelectContent styles
can override that typography. Native-size Buttons preserve their children’s
layout inside host workbench controls, and `Panel variant="docked"` omits card
borders, rounding, and shadows for docked regions. Docked panels clip and isolate
positioned content. Floating menus and popovers use the host font and scale
geometry with `--onyx-scale-ui`.
Switch, Checkbox, RadioGroupItem, Toggle, ToggleGroup, Button, Spinner, Progress, Meter,
TabsList, SectionSelect, Slider, PasswordField, CollapsibleTrigger, AccordionTrigger, Alert and
the toast provider/viewport are Golem's (`@mroiban/golem`): the same Onyx controls and props, with
an Anima motion part the pebble serves itself at `/_bedrock/anima/<version>/`. Nothing to set up.
Motion follows `prefers-reduced-motion`; `<GolemProvider motion="css">` turns it off, and without
the runtime every control is plain Onyx.
Onyx and Golem come from published releases (`@mroiban/onyx`, `@mroiban/golem`); maintainers upgrade one by
changing its release URL in `packages/ui/package.json`, then running `bun install`
and `bun run build:css` in `packages/ui`.

## Host operations and backups

`install.sh`/`install.ps1` run `bun link` in `packages/bedrock` (the `bedrock`
bin and `link:bedrock`) and `packages/ui` (`link:@bedrock/ui`); `self-update`
repeats both and `new` registers any that are missing. Ensure Bun's bin
directory is on PATH. `bedrock version` (also `bedrock --version`) prints local
package/checkout identity, platform, architecture and Bun version; `--json`
exposes version, commit, branch, dirty, platform, arch and bun. Git fields are null
outside a checkout.

Bare `bedrock`, `bedrock help`, `bedrock --help` and `bedrock -h` show the grouped
command overview (exit 0). Every command/subcommand accepts `--help`/`-h` anywhere
before `--`, without performing actions. `bedrock help <command> [<sub>]` shows
usage, arguments, options, examples and guide links; `bedrock help env` explains
environment settings and `bedrock help exit-codes` explains process results.
JSON overview help returns `{ ok: true, command: "help", commands, topics,
globalFlags, remoteFlags }` with the visible command tree. Command help retains
`{ ok: true, command, usage, description }`, adding summary, args, flags,
subcommands, examples and docs; `command` is the path and `usage` a synopsis string.
Default-command help includes `defaultSubcommand` and describes the default
form's arguments and options, such as `bedrock errors [ls] <pebble>`.

Use `--flag value`, `--flag=value` or a declared short alias (`logs -f`). `--`
ends options: later words are literal arguments. Prefix abbreviations, repeated
flags, missing/extra arguments and invalid choices fail with a usage hint.
A value flag accepts single-dash words (`--name -agent`), but needs `=` for a
value starting with `--` or matching a declared flag. Flags may precede subcommands.
An incomplete subcommand falls back to the default form when it accepts all
words: `errors show` lists the pebble `show`; `errors show notes 42` inspects issue 42.
Typos in commands, subcommands, flags and choices suggest corrected command lines;
guesses are never executed and secret flag values are redacted. Text errors use
`CODE: message`, an optional “Did you mean …?” block, then `Hint: ...` on stderr.
JSON errors preserve `code`, `message`, `hint` and optional `data.suggestions`.
Daemon name suggestions include `data.unknown` and only authorized candidates
(pebbles, jobs, error issues or backup timestamps); the CLI renders them as commands.
Repairs target the rejected argument, preserving command words and other flag
values. Redaction covers secrets starting with `-`; messages omit inline option
values. Synonym typos such as `jobs lsit` suggest `jobs ls`; mixed ties omit
destructive commands. Unknown flags never suggest help: `logs -n` suggests
`--limit`, and `rm -f notes` suggests `rm notes --yes` with a deletion warning.
Unauthorized/public responses never gain suggestions; empty suggestions omit data.
Exit codes: 0 success/discovery, 1 command failure, 2 usage error
(`UNKNOWN_COMMAND`, `INVALID_ARGS`, `CONFIRM_REQUIRED`), 130 prompt cancellation
(`CANCELLED`). `bedrock test` uses 1 for failed checks/flakes and 2 for setup failure.
Text lists preserve complete identifiers (including token IDs and backup timestamps),
using vertical `KEY: value` rows when the terminal is too narrow. Empty `ls`
prints a next step; populated output includes release provenance and public routes.
`status` summarizes readiness, URL, memory, last-five-minute requests, failure rate,
p95 header latency ranges and backup age; missing observations say `unknown`.
`whoami` focuses on the daemon URL, build and identity. `alerts` includes active
silences and delivery pending/oldest, outbox states and last failure (or explicit
unknown when scope omits delivery). Text strips terminal controls from supplied
content; JSON is unchanged. Skipped/unverified tunnel checks use `!`. Doctor
prints repair hints only for warnings and failures. Invalid daemon `--port`
(0–65535), metrics/logs `--limit` (1–1000) or `--since` (positive integer
s/m/h/d up to 365d) fails with command-local usage before connecting or starting.

Text output uses tables, confirmations and useful `Next:` hints; colour requires
a TTY without `NO_COLOR` (even an empty value disables it). Scripts should use
`--json`: existing result shapes stay unchanged (one value; doctor returns an array).
Destructive actions such as `bedrock rm notes --yes` require confirmation.
Invalid pebble names fail with `INVALID_PEBBLE_NAME`.

Install completion, then reload the shell configuration:

- Bash: `bedrock completion bash >> ~/.bashrc`.
- Zsh: add `source <(bedrock completion zsh)` after `compinit` in `~/.zshrc`.
- Fish: create `~/.config/fish/completions/`, then run `bedrock completion fish > ~/.config/fish/completions/bedrock.fish`.
- PowerShell: create `$PROFILE` if absent, then `bedrock completion powershell >> $PROFILE`.
Completion includes commands, flags, choices and local daemon pebble names
(with a 500 ms budget; static completion works without the daemon).
Shell insertion quotes candidates as literal words, including shell metacharacters.

```sh
# Home server (after checkout/install.sh):
bedrock setup
bedrock setup --status --json
bedrock setup google       # redo a step; then setup to restart and verify
# Unattended alternative (Cloudflare token discovers zone/account):
bedrock setup --yes --json --domain example.com --creator you@example.com \
  --api-token TOKEN --google-client-id ID.apps.googleusercontent.com \
  --google-client-secret SECRET --dir /mnt/backup/bedrock --skip-sign-in
# Laptop:
bedrock login example.com
bedrock new notes && cd notes
bedrock dev
bedrock deploy             # prints/opens URL; --no-open disables opening
bedrock whoami
bedrock status --json
bedrock self-update        # local clean checkout: git pull --ff-only, bun install, bun link, service restart
bedrock self-update --remote # logged-in daemon: update, restart, poll new boot/commit (120 s)
bedrock backup run
bedrock backup ls notes --json
bedrock backup restore notes --at 2026-10-06T03:00:00.000Z --yes
bedrock data move /data/bedrock  # daemon stopped: copy+verify pebble data/logs, set dataDir
bedrock doctor --json
bedrock token ls --json
bedrock pebble-token create notes --name agent --permissions query:list --as you@example.com --json
bedrock pebble-token revoke notes <id> --as you@example.com --yes --json
bedrock session create notes --ttl 15m --as you@example.com --json
bedrock logout
```

The daemon runs all pebbles on private localhost ports, proxies hostnames, enforces
access/Origin and supervises crashes. Crash recovery uses jittered exponential
backoff for the first four failures, then retries indefinitely every 4.5–5 minutes
with status `crashed`; a healthy retry becomes `running`. Ten minutes of uptime
resets the failure streak. Explicit stop/deletion/shutdown cancel retries;
replacement activation supersedes them. Boot restores crashed pebbles too.
Status/list API and CLI JSON include `next_retry_at` (Unix milliseconds or null)
and `memory: { resident, swapped, hibernated_at }`. The byte counts come from
cgroup `memory.current` (including cache/kernel memory) and `memory.swap.current`;
`hibernated_at` is Unix milliseconds, cleared by proxied activity. All three are
null without a supported live child cgroup. Hibernated pebbles stay `running`.
Linux gives each child a generous `memory.high` runaway throttle of at least
1 GiB or one quarter of host RAM, whichever is larger, with no hard memory limit.
Linux children get a best-effort `oom_score_adj` increase of 500 over the daemon,
capped at 1000, to prefer killing a pebble under memory pressure. `$BEDROCK_HOME` defaults to `~/.bedrock`.
To keep code on a fast disk and pebble data on a large one, set `dataDir` in
config.json (`bedrock setup identity --data-dir /data/bedrock` on a fresh
install): each pebble's `data/` (BEDROCK_DATA, ctx.dataDir) and `logs/` then live
under `<dataDir>/pebbles/<name>/`. Move existing data with the daemon stopped:
`bedrock data move <dir>` copies, verifies every file by SHA-256, switches
`dataDir`, and keeps the old copy for you to delete. The daemon refuses to start
when `<dataDir>/pebbles` is missing (an unmounted disk). Pebbles that need large
caches or browser profiles should keep them under ctx.dataDir so they follow it.
Only Bun and `cloudflared` need installing (OS service managers are built in).
Setup defaults to Cloudflare browser authorization and a locally managed tunnel:
origin certificate, credentials and ingress YAML live under cloudflared/ in
BEDROCK_HOME. API-token setup uses a remote tunnel and saves only its run token
mode 0600. API tokens are transient. Both modes share wildcard ingress and DNS.
setup.json records completed/deferred steps; setup resumes failures. Every wizard
prompt has a flag. Non-TTY, --yes and --json never prompt; missing flag errors list
required choices. Use --skip-google, --skip-backups, --skip-sign-in to defer optional
setup, --install-cloudflared to authorize OS packages and --enable-linger on Linux.
R2 uses --r2-bucket, --r2-access-key-id, --r2-secret-access-key and --r2-account
(optional when an API token can discover it). Google setup opens console guidance;
verify opens the dashboard and polls creator sign-in. Public pebbles need no Google. Google
redirect URI: `https://auth.<domain>/callback`. Restart the daemon after tunnel
setup. Services use launchd on macOS (user login) and systemd user on Linux
(`loginctl enable-linger "$USER"` for boot without login). Linux units use
`OOMPolicy=continue` so one child OOM kill does not stop the whole cloud, plus
`Delegate=yes` and `DelegateSubgroup=supervisor` for per-child memory accounting. Service
install writes the current unit; daemon CLI startup and local/remote self-update
refresh an installed matching-home unit's OOM and delegation settings and reload systemd when
changed. Windows 11 uses a
per-user Scheduled Task that starts at login and runs while the user is logged in.
Install with install.ps1; --install-cloudflared uses WinGet. Windows private files
use owner/SYSTEM NTFS ACLs. Device names such as con, nul, com1, and lpt1 cannot
be used as pebble or bucket names on Windows.

Remote CLI credentials live in XDG_CONFIG_HOME/bedrock/credentials.json or
~/.config/bedrock/credentials.json, mode 0600. Precedence: explicit flags, env
BEDROCK_URL/BEDROCK_TOKEN, reachable local daemon, saved remote credentials.
`bedrock login <domain>` on the server explains how to use the local admin token
with `pebble-token create --as` or `session create --as`. For browser login tokens,
run login on the computer with the browser: its callback listens on 127.0.0.1.
Remote operational commands accept `--url`/`--token`. Backup setup is server-local;
run it on the home server. R2 setup prompts for the secret when omitted, or accepts
`--r2-secret-access-key`. Credentials are in `$BEDROCK_HOME/backup-credentials`,
mode 0600, separate from non-secret `config.json`. No R2 request is made by setup.

Backups run on daemon startup when due, then check each minute. Defaults:
intervalMinutes=60, keep=24 (the newest 24 snapshots are kept; older ones are
pruned). Configure setup with `--interval-minutes 60 --keep 24`, or edit `config.backup`:

```json
{ "type": "fs", "directory": "/mnt/external/bedrock", "intervalMinutes": 60, "keep": 24 }
```

R2 config uses `type: "r2", account, bucket` plus the same scheduling/retention
fields. The endpoint is `https://<account>.r2.cloudflarestorage.com`.
Native S3 listing is used when available; Bun 1.2 uses a dependency-free
SigV4 ListObjectsV2 fallback. Built-in targets implement async
`{ put, get, exists, list, delete }` (put accepts bytes or a Bun file) using
Bun.S3Client or filesystem; no Litestream/restic. The target directory should be
outside BEDROCK_HOME, on another disk for disk-failure protection.

Object layout:

```text
pebbles/<name>/db/<filename timestamp>.sqlite.gz
pebbles/<name>/files/<SHA-256>
pebbles/<name>/manifests/<filename timestamp>.json
daemon/db/<filename timestamp>.sqlite.gz
daemon/manifests/<filename timestamp>.json
```

Filename timestamps replace ISO time colons with hyphens; manifest timestamps
and backup restore --at remain ISO. Existing manifests retain their stored keys.
SQLite is snapshotted consistently with VACUUM INTO while live, then gzipped.
Snapshot SQLite work, hashing and compression run in a Bun Worker thread, keeping
the daemon's HTTP proxy responsive. Database hashing/compression stream through
files staged beside the database; disk uploads copy the gzip file and R2 streams
it with bounded multipart buffering. The DB checksum covers uncompressed SQLite
bytes. Worker failures remove staging files and fail the backup; daemon shutdown
cancels active snapshots.
Files use metadata SHA-256 and upload only if absent. Manifest contains timestamp,
db key/checksum, file id→SHA-256, package version and migration name/hash list.
Manifests publish last. Retention keeps the newest `keep` snapshots (default 24)
and collects blobs unreferenced by retained manifests. Failed uploads may leave
orphans until the next successful pruning pass. A concurrent file deletion may
fail a live snapshot; the daemon logs it and retries at the next interval.

Configure plain directory trees with
`definePebble({ backup: { directories: ["workspaces"], exclude: ["**/node_modules/**"] }, ... })`.
Roots are relative to dataDir; no absolute/dot-segment/backslash paths, overlapping
roots or reserved db.sqlite/files/uploads. Symlinks/special files are skipped;
empty directories and file modes/mtimes are recorded. Directory SHA-256 blobs
share the per-pebble files namespace, work with disk/R2, and are kept by retention
GC while any retained manifest references them. Restore verifies size/checksum
and recreates the trees in the staged data directory. Snapshots are best effort:
files may change independently during a walk, with no quiesce or consistency
across files; a concurrent deletion can fail the snapshot. The hash covers the
bytes actually read. Old manifests without directories remain restorable.

`backup run [pebble]` also snapshots the daemon identity DB. `backup run` backs up
all registered pebbles and records full success for scheduling. Doctor checks the
oldest latest backup across identity and registered pebbles, warning after 2× the
interval or if any has never succeeded. Restore requires `--yes`, stops the
pebble, verifies DB SHA-256/integrity and every file against manifest/DB metadata,
stages a data directory beside the old one, renames the old one to
`data.before-restore-<timestamp>-<suffix>`, and starts the currently selected
release. Retained old data is not automatically removed. The two directory
renames run while stopped; a host crash between them requires selecting the
preserved directory manually. Restore can reapply current-code migrations; choose
compatible code before restoring an older schema. Releases, config and credentials
are not included in snapshots. Daemon DB recovery requires an offline procedure;
there is no live daemon identity restore command.

Status reports boot-time `{ version, commit, branch, dirty, platform, arch, bun }`,
`instanceId` (new per daemon boot), and `features`: sockets, services,
directory-backups, chunked-uploads, chunked-uploads-cancel. Human status prints this beside the daemon URL;
JSON includes all fields. Deploy checks sockets/services in the pebble
and directory backups before archiving/upload; absent features mean an old daemon.
Doctor warns on a local daemon missing sockets/services.

Remote self-update requires an installed service and a clean source checkout;
pebble bearer tokens are rejected by the daemon's deploy-token authorization.
POST returns `{ from, to, updated, output }` with redacted Git/Bun output and
schedules a restart after a two-second response-flush delay. Concurrent requests
are refused until restart. Windows launches the delayed PowerShell restart via CIM
Win32_Process.Create, outside the Scheduled Task tree reaped by taskkill /T;
macOS/Linux use a detached Bun helper. Startup restores running/restarting pebbles,
leaving idle ones asleep and stopped ones stopped. A failed install/restart may leave an advanced Git
checkout. Older daemons need one server-local update before this endpoint exists.

Missing secret unsets, deploy/service-token revocations and pebble deletion remain
idempotent; secrets can still be staged before deploy. Alert silences still accept
arbitrary fingerprints for unscoped callers; scoped callers must use a visible
incident and retain the existing indistinguishable forbidden response otherwise.

Daemon API (Bearer creator deploy token): GET `/api/pebbles`, GET `/api/status`,
POST `/api/self-update`;
POST `/api/deploy?name=<name>` (tar.gz); POST `/api/pebbles/<name>/start|stop|restart|rollback`
(`?force=true` for rollback); GET `/api/pebbles/<name>/logs?follow=true`;
DELETE `/api/pebbles/<name>?confirm=true`; GET/POST `/api/tokens`,
DELETE `/api/tokens/<hash>|current`; GET `/api/jobs/<pebble>`;
POST `/api/jobs/<pebble>?job=<name>`; POST `/api/backup/run?name=<optional-pebble>`;
GET `/api/backup/ls?name=<pebble>`;
POST `/api/backup/restore?name=<pebble>&at=<optional-exact-timestamp>&confirm=true`.

Low-level tests can import `startPebble` from `bedrock/server`, call
`startPebble({ dir, dataDir: temporaryDirectory, port: 0 })`, and use
`{ server, pebble, db, execute, jobs, stop }`. `execute(kind, name, args, request)`
returns value/read/write sets. `startDaemon({ home: temporaryHome })` comes from
`bedrock/daemon`. Always use temporary BEDROCK_HOME/dataDir/credential paths in tests.

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
Reads require scoped **logs** or **monitor**; changes require **lifecycle**
(or **monitor** for resolve/ignore), all restricted by pebble globs. Detail and changes return `NOT_FOUND` when the issue does not
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

No pebble instrumentation or configuration is required. `bedrock status --json`
adds per-pebble current in-flight/open sockets, rolling 5 min RED, latest cgroup
resources/lifecycle, coverage and drop counters. Idle pebbles stay asleep.

```sh
bedrock metrics notes --since 1h --step 1m --json
bedrock logs notes --search 'timeout OR "connection reset"' --since 1h --json
bedrock logs notes --follow
```

Metrics use UTC `1m|1h|1d` rollups (7/90/365 days). Headers-ready and body or
WebSocket lifetime histograms separate success/failure; p95 is a bucket range
in seconds, `upper:null` means above 10 s, and no samples means null. 5xx and
transport/body failures count once; 4xx/429 and client aborts are separate.
Traffic classes are ordinary, stream (SSE/NDJSON/stream responses), websocket
and control. WebSockets also report handshakes; completion is connection close.
Resource samples every 15 s reuse Linux cgroups (memory/swap, CPU and OOM deltas),
including deploy overlap; unsupported/idle/unreadable values are explicit nulls
in status and do not create stored resource rows. Stopped children show nulls
immediately, even if a recent sample remains in history. CPU 100%
means one core. Lifecycle includes spawn/ready/exit/crash, retry, idle/wake,
hibernate, stop and deploy/retire.

The daemon's Worker owns `$BEDROCK_HOME/observability.sqlite`; it stays on the
home filesystem across `dataDir` moves and is excluded from backups. Writes
batch every second/256 records in a bounded queue and never hold up serving.
Byte budgets apply before time retention: total 512 MiB, logs 256, events 64,
metrics/resources 160, lifecycle 32. Metrics reserve 4/32/96/22/6 MiB for
status/raw resources/minute/hour/day tiers; oldest rows within the affected tier
are evicted with counters. Empty traffic classes and empty histogram buckets
are omitted on disk; public metric fields stay unchanged. The physical DB cap
remains 248 MiB so even a full-DB WAL transaction fits within 512 MiB; physical
pressure reclaims raw records, then minute/hour/day history, then status last. Logs retain 7 d;
request/lifecycle events 90 d. Coverage and drops may shorten any history;
missing telemetry is unknown, never zero traffic. Runtime drops are scoped to
the daemon boot, with snapshots from previous boots reported separately.

stdout/stderr go to SQLite FTS5, capped at 16 KiB/line, 50 lines/s and
128 KiB/s/pebble; drops/truncations are counted. Secret values (at least eight
characters, including JSON escapes) are scrubbed before enqueueing and again in
the Worker. Avoid logging private data yourself. Unknown request paths collapse
every segment; diagnostic events capture no queries, headers, bodies, IPs or
identity. Every failure/slow request plus 1% successes is eligible, capped at
10 events/s/pebble independently of unsampled RED.

Existing rotated pebble logs remain read-only legacy files. Plain logs and
follow include their bounded tail; JSON/search only covers SQLite history.
Follow subscribes before reading history and reconciles a stable acceptance
watermark, avoiding initialization gaps/duplicates. Live initialization buffering
is bounded to 1 MiB; overflow closes the follower. Follow remains best effort
and may show a line whose later storage batch fails. Cloudflared keeps its existing rotated file. Disk/storage failure drops
telemetry with one notice per outage and retries once a minute; a failed Worker
restarts automatically. Delete purges the pebble's telemetry asynchronously.

JSON metrics/log search use the Bedrock envelope with `rows`, opaque `cursor`,
requested `range`, retained `coverage`, writer intervals and drops. Use
`--cursor <returned-cursor>` / `--limit 1..1000`, `--since <positive s|m|h|d>`
(up to 365d). Follow (`-f`/`--follow`) cannot combine with search/since/cursor;
JSON follow retains the single string stream with coverage/drop metadata on close. Creator API equivalents:
GET `/api/pebbles/:name/metrics|resources|lifecycle` require scoped `status`;
`/events|logs` require `logs`, always restricted by pebble glob. Parameters are
`since`, epoch-ms `from`/`to`, `step`, `cursor`, `limit`; logs add FTS5 `q` and
`format=json`. Bad ranges/search return `INVALID_ARGS`; outages return
`TELEMETRY_UNAVAILABLE`/`DISK_FULL`. Status reports unknown data when unavailable.

### Secrets, scoped deploy tokens and service tokens

```sh
bedrock secrets ls upty --json
printf '%s' "$DISCORD_TOKEN" | bedrock secrets set upty DISCORD_TOKEN --restart
bedrock secrets unset upty DISCORD_TOKEN --restart
bedrock token create --name manager --pebbles "upty,bot-*" --actions deploy,lifecycle,logs,secrets,status,service-tokens --json
```

GET/PUT `/api/pebbles/:name/secrets` return
`{ ok: true, value: { secrets: [{ name, updatedAt }] } }` without secret values.
PUT accepts `{ set?: Record<string,string>, unset?: string[],
restart?: boolean }`, even before first deploy (restart requires a deployment).
Names match `^[A-Z][A-Z0-9_]{0,63}$`; runtime and OS environment controls are
reserved. Values come from stdin or a hidden prompt, never CLI argv. Secrets are
private `$BEDROCK_HOME/pebbles/<name>/secrets.json`, outside releases/data and
excluded from DB/directory backups; back up credentials separately. Every launch
receives an allow-listed host environment, then pebble secrets, then reserved
`BEDROCK_*` values, including `BEDROCK_API_URL` pointing to the loopback daemon API.
The allow-list contains runtime/OS essentials, locale (`LC_*` included), proxy
and certificate settings, matched case-insensitively. Supply credentials through
`bedrock secrets`, never the daemon/service environment. Attached dev sources
(`bedrock dev`) inherit the developer's full shell environment before these overlays.
Restart checks replacement health before retiring the old child; a failed restart leaves the secret update saved.

POST `/api/tokens` optionally accepts `{ name, scope: { pebbles: ["upty", "bot-*"],
actions: ["deploy", "lifecycle", "logs", "secrets", "status", "service-tokens", "monitor"] } }`.
Scoped tokens cannot manage tokens, self-update, backups, job control, host/config, or
unmatched pebbles (403 `FORBIDDEN`). Status/list endpoints filter matching pebbles.
`token ls` shows scope; unscoped tokens retain full access.

Use `bedrock token create --name monitor --pebbles "bot-*" --actions monitor --json`
for monitoring only. `monitor` permits GET status/list, matching pebble metrics, resources, lifecycle,
logs (including follow), errors/issue detail, and job history;
POST alert silence/test and matching issue resolve/ignore. It excludes error
merge, error transition history, events history, job control, deploy/lifecycle changes,
secrets, tokens, service tokens, backups, self-update and sessions. Actions combine
additively. Fleet status/list filter matching pebbles and omit tunnel/session
presence just like `status`. Alert reads expose only matching pebble incidents,
their silences and matching checks; a token scoped to `*` sees the whole host,
including tunnel/backup incidents and alert delivery state. Silence requires an exact visible incident fingerprint
(403 otherwise); there is no removal endpoint. Alert test sends a global test
notification without disclosing global monitoring data.
Status rows include read-only `backup: { last_success_at, interval_ms }` (Unix ms
of the last successful backup, null if unknown; configured interval ms, null if
unconfigured), without granting backup operations or revealing other backup state.

POST `/api/pebbles/:name/service-tokens` with `{ name, permissions: string[] }`
returns `{ ok: true, value: { id, token } }`; DELETE the same path plus `/:id`
returns `{ ok: true, value: { revoked: true } }`. Target must be running
with `tokens: true`. Tokens are
ordinary pebble `brk_` tokens owned by the calling deploy token's creator, minted
through child IPC in an executor mutation slot with `ctx.tokens.create` permission
validation. `bedrock pebble-token create <pebble> --name <name> --permissions <a,b>`
prints the token once; `pebble-token revoke <pebble> <id> --yes` revokes it.
There is no service-token list API or CLI `ls`.

Both commands accept `--as <email>` (API `?as=<email>`). Only the exact local admin
token from `$BEDROCK_HOME/admin-token` may select another existing configured
creator, including through the tunnel; source address is never an authorization
boundary. Unknown email returns `CREATOR_NOT_FOUND`; a non-creator or unauthorized
identity switch returns `FORBIDDEN` (403 with repair hints). No user or creator is
created. This adds no real power to the host user who already runs trusted daemon
code (ARCHITECTURE.md §8). Creator login tokens retain their own identity; `--as`
may repeat that email but cannot select someone else. Ownerless legacy/manual
tokens remain refused, even with `--as`. `TOKEN_OWNER_REQUIRED` points to these
server commands or browser-computer login. `TOKENS_DISABLED` and
`PEBBLE_STOPPED` return 409; `INVALID_TOKEN_PERMISSION` returns 400.
All daemon API successes use
`{ ok: true, value }`; errors use `{ ok: false, error: { code, message, hint } }`.
Secrets/service-token responses retain `Cache-Control: no-store`; CLI JSON output
is unchanged.


### One-time creator sign-in for deployed pages

`bedrock session create <pebble> [--ttl 15m] [--as <email>] [--json]` returns
`{ ok: true, command: "session create", value: { url, expiresAt } }`. It accepts
`--url`/`--token` and calls POST `/api/pebbles/:name/sessions[?as=<email>]` with
`{ ttl?: "15m" }`. The pebble must be deployed. Only unscoped tokens can mint
links; existing-creator selection follows the same rules as service tokens.
TTL uses integer `s`, `m`, or `h`, defaults to 15 minutes, and is positive and at
most 1 hour. The link and session expire at issuance plus TTL; expiry never slides.

Open the returned URL in the browser and press **Sign in**. The secret is in a
fragment, removed from history by a CSP-hashed script, then sent only in the
confirmation POST body. JavaScript is required. GET scanners cannot consume it,
and the secret is absent from HTTP URLs, referrers and Bedrock logs. The daemon
stores only its hash. Redemption requires the exact pebble Origin and atomically
consumes the link and creates the ordinary session. Unknown, expired or reused
secrets submitted to the form get a styled error page. Success redirects to a
clean pebble root with `Referrer-Policy: no-referrer`; responses are not cached.
The link is bound to one pebble, but its resulting cookie carries the ordinary
**global creator identity** until the fixed expiry. A leaked unused link grants
that identity to its first redeemer. No pebble changes are needed; use temporary
homes and fake users for tests, never real creator cookies.

## Testing your pebble

Run `bedrock test --json`: Bun tests under `tests/unit` first, then built-in smoke
and ordinary Playwright `tests/e2e/**/*.spec.ts`. Install browser tooling only as
**dev dependencies**: `bun add --dev @playwright/test@1.64.0 @axe-core/playwright@4.14.0`,
then `bunx playwright install chromium`. One Chromium worker runs both desktop
1280×800 and phone 390×844. API-only pebbles skip built-in browser smoke.

Runtime unit tests use `startPebble({ dir, dataDir, port: 0, cron: false })` from
`bedrock/server`, real SQLite and `app.execute`/`app.jobs.run(name)`; always stop
the app in `finally`. The command supplies a temporary `BEDROCK_HOME`. Browser
cases get separate daemon/data homes copied from a closed migration + seed
template, port 0, no watching or scheduled jobs. Services still run: use your
own substitutes for external mail/devices/APIs. `server.runJob(name)` invokes
jobs explicitly. No deployed data/secrets or shell application secrets are used.

Optional `tests/seed.ts` default-exports a function receiving
`{ db, sqlite, dataDir, users, now }`. Fixture IDs are `bedrock-test-owner`,
`bedrock-test-friend`, `bedrock-test-outsider`; `now` is fixed at
`2024-01-01T00:00:00.000Z`. Use fixed IDs/dates for application rows too.
Optional `bedrock.test.ts` exports `{ seed?, users?, pages?, prepareScreenshot? }`:

```ts
import type { TestConfig } from "bedrock/testing";
export default {
  pages: [{ path: "/", user: "owner", ready: '[data-testid="app-ready"]' }],
} satisfies TestConfig;
```

`users` maps owner/friend/outsider to emails (defaults `<role>@example.test`;
owner is a creator). Override addresses for allow-list pebbles. No config: smoke
`/` as owner, plus anonymously if public. The readiness fallback is the first
`[data-bedrock-ready]`, `main` or `[role="main"]`; set an app-specific selector
when that would match a loading shell, or when your app has no main landmark.
Login redirects never establish app readiness. Explicit pages can select
`anonymous`, `owner`, `friend`, `outsider`. Smoke checks fail browser errors,
definite axe WCAG A/AA violations, and horizontal overflow beyond 1px; axe
`incomplete` is listed for manual review.

Import `{ test, expect, loginAs }` from `bedrock/testing`. `test` supplies
`server`, `loginAs(page, "friend")` and separate-context `anonymous`, `owner`,
`friend`, `outsider` pages. Login uses the real dev form and session enforcement.
The ordinary `page` starts anonymous. Browser API checks can use same-origin
`page.evaluate(() => fetch(...))`; the separate Playwright API request client
may not resolve `*.localhost` on your host.

Screenshots are opt-in (`visual: true` per page): threshold 0.2, zero changed
pixels, disabled animations, reduced motion, fonts/images ready. Bundle fonts
and use `prepareScreenshot(page)` for animated runtime state. Approve baselines
on the home server (Linux/pinned Chromium) with `--update-snapshots --yes`, then
review and commit `tests/e2e/__screenshots__`. Ordinary missing baselines fail.

`--grep`, `--project desktop|phone`, `[path]`, `--list`, `--headed`, `--repeat N`
select/diagnose browser tests; units still run unless listing. No retries by
default; `--diagnostic-retry` marks a passing retry flaky and still fails.
Exit codes are 0 pass, 1 check failure, 2 setup failure. JSON failures carry the
report in `error.data`; success uses `value`. Logs, axe results, failure PNGs and
traces live in `.bedrock/tests/<run>/`, pruned after 7 days / 500 MiB, preserving
the current run. See `bedrock test --help` and the reference's Testing pebbles
section for the full contract.

## Common mistakes

- Importing `pebble.ts` as a runtime value in browser code bundles server code.
  Use `import type pebble` and type the client/hooks.
- Forgetting `schema` or `storage` registration. Register all tables through
  `schema` and exact bucket objects through `storage`.
- Treating sign-in as row authorization. Filter/check ownership in every handler;
  custom routes need these checks too.
- Assuming a job has a user. It runs with `null`; choose storage policies accordingly.
- Raw SQL writes without invalidation, or raw SQL query reads without tracking.
  Prefer Drizzle; pass table objects to invalidate, or SQL table names rather
  than schema export keys.
- Returning BigInt or executing transaction-control SQL in a handler/migration.
  Return JSON-compatible values and let Bedrock own transaction boundaries.
- Editing applied migrations, skipping migration generation or `bedrock db check`
  after merging branches, or putting runtime dependencies only in devDependencies. Commit new migrations and put
  production dependencies in dependencies.
- Hooks outside BedrockProvider, missing @bedrock/ui/styles.css, or assuming the
  shipped stylesheet generates arbitrary consumer Tailwind classes.
- A pebble `bunfig.toml` without `"bedrock/bundler"` in `[serve.static] plugins`.
  The page bundles two Reacts and renders blank (`reading 'useContext'` of null).
- Replaying an uncertain mutation or assuming jobs provide exactly-once delivery.
  Use idempotent application operations. Job overlap protection is process-local;
  a deploy handoff can briefly have two schedulers.
- Expecting rollback to undo schema/data or a backup to contain release code.
  Keep source/config backups too, inspect migrations, and test restores.
- Testing against ~/.bedrock or real Cloudflare/R2. Use temp directories and mocks.

Disk exhaustion: SQLite FULL and filesystem ENOSPC/EDQUOT surface as
`DISK_FULL` (HTTP 507), with the affected path and a free-space/quota hint.
Reads remain available; retry writes after freeing space, without restarting.
The mutation queue keeps SQLite's auto-rollback guard. Logs drop disk writes on
exhaustion, emit one stderr notice per outage and retry at most once a minute.
`bedrock doctor --json` reports available/total bytes for the daemon home and
configured data directory; it warns below 1 GiB or 5% available. Deploys check
available space before accepting the archive and before extracting it.
Backups check for twice the database + WAL size plus 64 MiB beside the database;
filesystem targets also reserve the object size plus 64 MiB before writing.
A disk-full backup is skipped independently and retried next cycle. Inspect
`backup-state.json` warnings, backup command results, doctor and daemon logs;
skipped snapshots never advance their success timestamps. Snapshot staging is
removed after failure/cancellation; the next snapshot also reclaims staging
owned by dead daemon PIDs before checking space.


### Readiness and alerting

`/_bedrock/health` stays liveness. The daemon probes readiness through IPC every
30 s (2 concurrent, 2 s deadline): migrations applied, SQLite schema readable and
all declared services started. Diagnostic reads fail immediately on SQLite lock
contention, restoring the application timeout afterwards. States are starting/ready/degraded/failed/idle/
stopped. Three failed probes open a check; two successes recover it. Readiness
in `bedrock status --json` carries observation time; stale observations are
unknown/starting. Idle means available on demand: probes never wake it or reset
idle timers. A child swap during a probe keeps the registered pebble as
starting/unknown; deletion cleanup requires registry removal. Hibernated children
remain running. This checks local resources, not external dependencies or
application correctness.

Jobs emit scheduled/started/succeeded/failed/skipped/interrupted events; the
daemon keeps next expected occurrences even if the child scheduler dies. Five
minutes start grace, ten minutes runtime budget (including queue wait), no
killing/catch-up. Each overdue occurrence is checked from the previous deadline
before advancing, so an earlier success cannot hide a subsequent miss. Each sweep
commits at most 256 evidence/gap steps globally, oldest deadline first. Indexed
range lookups identify missing spans without walking every minute of an empty
backlog; dense evidence continues in later sweeps/restarts with persisted cursors.
No old window is discarded. A restart gap is one incident per job; unfinished
starts become interrupted. History is newest 1,000 events via `bedrock jobs history <pebble>
--json`, with 30 days/100,000 events global retention. Success means commit or
detached handler completion, not exactly-once external side effects.

Critical job selection is host administration, not a new pebble option:
`alerts.criticalJobs: { notes: ["prune"] }` in daemon config (none by default).
Four page rules: configured cloudflared process absent, desired-running pebble
unready for 2 min/crash loop, critical job failure/deadline, configured backup age
>2 intervals. Backup config is reloaded each sweep; setup/interval edits/removal
apply without restart. Ordinary job errors/skips and other noise enter digests.
A webhook submission outage >10 min creates a local incident/stderr notice; independent
external monitoring is needed because delivery cannot page through itself.

Use `bedrock alerts [ls] --json`, `alerts silence <fingerprint> --for 2h --json`,
and `alerts test --json`. `alerts setup [--webhook <url>] --json` reads the
bearer secret from stdin/hidden prompt into BEDROCK_HOME/alerts-secret (0600);
default URL is https://comms.<domain>/api/v1/messages. Restart after alert config edits.
Webhook hosts in this daemon's <pebble>.<domain> namespace use its loopback proxy,
retaining Host/path, normal access rules and idle wake-up without cloudflared.
External webhook URLs remain generic.
The durable generic webhook uses comms-shaped JSON, Authorization Bearer,
Idempotency-Key and payload idempotency_key. Receivers must dedupe; 2xx means
accepted, not provider delivered. Initial ntfy (no Poke), ntfy+email after 15 min unresolved,
then reminders at most every 6 h. Critical incident transitions/escalations use
high urgency and bypass quiet hours in Bedrock and comms. Non-critical push
(including normal-urgency tests) waits during 23:00–07:30 Brussels; low-urgency
weekly Monday 08:00 server-local email digest, daily only while unresolved.
Already-stored payloads keep their original urgency. Transitions submit in stored
order per incident across retries/restarts; recovery waits for opening acceptance.

Incidents use stable [host,pebble,rule,job] fingerprints, 30 s grouping, one outbox
row per opening/resolution, expiring silences, and tunnel inhibition of child
readiness messages. Unrelated backup/job alerts remain eligible. The Worker keeps
alerts.sqlite separate from disposable telemetry; 64 MiB page budget, 1,000
pending transitions, retries to 6 h, no pending eviction. Storage failure leaves
serving independent. A full outbox rolls back the new transition until a later
sweep. Terminal job events retain a durable pending-evaluation marker until
incident/outbox evaluation commits, retried in order across saturation/restart.
Retention runs before admission and independently during delivery; byte pressure
reclaims accepted/suppressed history, unreferenced resolved incidents and evaluated
job history to reserve 4 MiB for pending work. Pending transitions/evaluations,
unfinished starts, and events scheduled at or beyond the current job deadline
cursor are never evicted by retention or byte pressure. Active evidence may
outlive history age/count limits until its consumers advance. Disposable histories
expire after at most 365 days; alert state/credentials
are excluded from existing daemon DB backups. Alert and job history APIs accept unscoped creator tokens or scoped **monitor**
with the filtering above. Outbox metadata requires an unscoped or `*`-scoped token;
scoped status only reveals matching readiness.

Unauthenticated https://bedrock.<domain>/healthz returns exactly 200 and
bedrock-health-v1 plus newline, or 503, fixed text <32 bytes, no-store, no names.
An outside prober must require status/body, disable redirects/cache and bound the
body; configure a Cloudflare cache bypass. Registry viability is all it proves;
whole-host/network failures need an off-box watcher. See
[the reference](../../docs/reference.md#readiness-jobs-and-alerts) for exact APIs,
retention, retry, silence, quiet-hours and submission semantics.
