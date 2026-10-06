# Building pebbles with Bedrock

Requires Bun ≥ 1.2, TypeScript and ESM. Run everything with Bun: the package ships
TypeScript source. `pebble.ts` default-exports `definePebble(...)` and is the single
source of truth. The repository's `ARCHITECTURE.md` is the implementation contract.
This reference also ships as `llms.txt`.

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
  plugins: [],
  // Add web: "./web/index.html" when you have a frontend.
});
```

Run `bedrock db generate`, commit `migrations/` (including `meta/`), then
`bedrock dev`. Data lives in `.bedrock/db.sqlite` and `.bedrock/files/`.
Dev uses a localhost daemon and a private child; the printed URL is
`http://notes.localhost:3000`. Protected pages use an email-picker login.
The default `bedrock new notes` React template includes a complete frontend, installs
dependencies, generates migrations and commits. `new --template minimal` is public
HTML; `init <name> [--template react]` scaffolds in the current empty directory.

## Configuration and functions

`definePebble` fields:

| Field | Meaning |
| --- | --- |
| `name` | 1–32 lowercase letters, digits, hyphens; `auth`, `bedrock`, `www` reserved |
| `access` | `"public"` (default), `"users"`, `"creators"`, or `{ allow: ["a@x.com", "@company.com"] }` |
| `schema` | Named Drizzle SQLite tables; `_bedrock_` SQL names reserved |
| `queries`, `mutations` | Maps of named `query(...)` / `mutation(...)` definitions |
| `storage` | Array of standalone registered bucket objects |
| `sync` | `true` enables reactive WebSocket subscriptions |
| `web` | Bun HTML entry path, or static directory, relative to pebble directory |
| `routes` | Bun handlers keyed by `"METHOD /path"`; `/_bedrock/` reserved |
| `jobs` | Map of `job(cron, handler)` definitions |
| `plugins` | Array of `plugin({ name, schema?, routes?, jobs?, onQuery?, onMutation? })` |

`query(fn)`, `query(standardSchema, fn)`, `mutation(fn)`, and
`mutation(standardSchema, fn)` retain argument/result types. Standard Schema v1
validation may be async and transform input. Function names start with a letter,
then letters/digits/underscores; prototype names are rejected. Results must be
JSON-serializable: Dates cross the wire as strings, `undefined` becomes `null`.

Handlers receive `FunctionContext`:

```ts
{ db, user, pebble, storage, request, invalidate }
```

`db` is Drizzle over `bun:sqlite`; builders/operators are re-exported from
`bedrock`. `user` is `{ id, email?, name?, avatarUrl? } | null`. `pebble.name` is
read-only metadata. `request` is the incoming Request (jobs use a synthetic one).
`invalidate(tables: readonly (string | SQLiteTable)[]): void` adds registered
Drizzle table objects or SQL table names to post-commit sync notifications. Prefer
`ctx.invalidate([notes])` over `ctx.invalidate(["notes"])`; unknown names throw
`BedrockError("UNKNOWN_TABLE", message, hint)`.

Queries run inside read-only transactions. Mutations, jobs, and custom routes run
inside write transactions, serialized within a process. Throwing rolls back SQL
and storage effects; errors become `BedrockError(code, message, hint)`. Middleware
executes inside the same transaction. Avoid slow network work inside handlers,
which delays other database requests. Do not open nested transactions or schedule
detached writes after your handler returns. External network side effects cannot
be rolled back with SQLite.

HTTP: `POST /_bedrock/q/<name>` or `POST /_bedrock/m/<name>`, with JSON arguments
(`null` without args), gives `{ ok: true, value }` or
`{ ok: false, error: { code, message, hint } }`.

## Schema and migrations

`bedrock db generate` makes an automatic Drizzle config from the pebble's merged
schema, including plugin tables even when they are not separately exported from
`pebble.ts`. `bedrock db plan` previews pending SQL; `bedrock db migrate` applies
it locally. Dev/deploy apply migrations automatically. Commit both SQL and metadata.
Never edit applied SQL: checksums are recorded in `_bedrock_migrations`. Put each
schema change in a new migration. Bedrock owns migration transaction boundaries.

Deploy keeps the last three code releases. `bedrock rollback notes` switches code,
not data; it refuses a target missing applied migrations. `--force` bypasses the
check when you have established compatibility. Restore a matching backup for
schema recovery; restarting the current code applies its pending migrations.

## Authentication, authorization and trust

Google OAuth and sessions belong to the daemon; identity is global, access is per
pebble. Configure Google's redirect URI as `https://auth.<domain>/callback`.
The daemon checks access before all pebble routes and strips external identity
headers/session cookies. Each child receives a separately derived signing secret;
functions and sync verify signed identity too. Direct low-level custom routes
retain Bun handler behavior; expose pebbles through the daemon, not their child
port. Route context resolves signed identity, but public/private routing is the
daemon's responsibility.

`"users"` permits all signed-in users, not only row owners. Queries and mutations
must enforce row authorization explicitly (e.g. filter `ownerId` and check it
before update/delete). Creators are configured on the server. Public handlers
must handle `user === null`. Jobs always have `user: null` and bypass pebble access
checks; they are trusted server code. Bucket access still applies in jobs.

End-user writes and WebSocket upgrades require the exact pebble Origin. Browser
clients supply cookies/Origin automatically. Direct non-browser HTTP calls must
provide Origin; use the SDK for normal requests. Logout closes the session's
sockets; expiry/revocation is checked periodically. WebSocket traffic alone does
not slide the 30-day session expiry.

Creators and their code are trusted. Pebbles have no OS isolation and can access
server files as the daemon user. Security boundaries protect against end users
and the internet, not hostile creators. Deploy tokens grant full daemon management.

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
argument. They return Response/Promise<Response>. They run in a write transaction
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

## Jobs

```ts
import { job, lt } from "bedrock";
// inside definePebble or plugin:
jobs: { prune: job("0 3 * * *", async ctx => {
  ctx.db.delete(notes).where(lt(notes.createdAt, Date.now() - 30 * 86400000)).run();
}) },
```

Cron has five fields: minute (0–59), hour (0–23), day (1–31), month (1–12), weekday
(0–7, 0/7 Sunday). Supports numbers, `*`, comma lists, inclusive ranges, `/steps`;
`5/20` means 5,25,45. Uses local server time. If both day and weekday are restricted,
either matching is sufficient (traditional cron). No named weekdays/months,
seconds field, catch-up, or persisted execution history. Each process schedules
once per observed minute; skipped minutes are not replayed. DST follows the local
clock: missing local minutes are skipped and repeated local minutes can run twice.

A job executes inside a write transaction with `user: null`, logs failures with
its name, and automatically tracks Drizzle writes for sync after commit. No
`invalidate()` call is needed for these writes. Overlapping runs of the same job are
skipped (manual or scheduled); different jobs queue through the executor.

```sh
bedrock jobs ls notes --json
bedrock jobs run notes prune --json
```

These use creator-authorized daemon APIs. The runtime jobs endpoint accepts only
the daemon's signed service identity; it is not an end-user mutation API.

## Plugins

```ts
import { plugin, sqliteTable, text, integer, job, lt } from "bedrock";
const audit = sqliteTable("audit_log", {
  id: text("id").primaryKey(), action: text("action").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const auditLog = plugin({
  name: "audit-log", schema: { audit },
  routes: { "GET /api/audit": (_request, _server, ctx) => Response.json(ctx.db.select().from(audit).all()) },
  jobs: { pruneAudit: job("0 3 * * *", ctx => {
    ctx.db.delete(audit).where(lt(audit.createdAt, Date.now() - 30 * 86400000)).run();
  }) },
  async onQuery(ctx, name, args, next) { return next(); },
  async onMutation(ctx, name, args, next) {
    const value = await next();
    ctx.db.insert(audit).values({ id: crypto.randomUUID(), action: name, createdAt: Date.now() }).run();
    return value;
  },
});
// definePebble({ plugins: [auditLog], ... })
```

Query/mutation middleware has `(ctx, name, validatedArgs, next)`;
`next(): Promise<unknown>`. Plugins compose in array order: A before → B before →
handler → B after → A after. Returning without `next()` short-circuits. Hooks wrap
only declared queries/mutations (not jobs, routes, or storage HTTP operations).
A thrown hook rolls back the whole transaction. A query hook is read-only too.

Plugin schema/routes/jobs merge into the pebble's normal maps. Duplicate plugin
names, schema export keys, SQL table names, route keys, or job names throw with
repair hints. Plugin tables migrate with `bedrock db generate`; do not migrate
inside hooks. The real tested example is `examples/plugins/audit-log.ts` in the
repository. Plugin routes need your own row/role authorization like other routes.

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

The client accepts `{ url?, sync?, headers? }`; url defaults to browser origin.
Pass an absolute URL outside the browser. `sync: false` uses HTTP; without server
sync, subscriptions deliver one HTTP snapshot. Connections reconnect and resubscribe
with backoff; uncertain mutations are never automatically replayed. Upload options
include `onProgress` (0–1) and `signal`. Client methods take bucket **names**, not
server objects. `user()` returns User|null, `loginUrl(returnTo?)` gives a login URL,
`logout()` signs out. Use ordinary browser cookies, not signed identity headers.

```tsx
import { createRoot } from "react-dom/client";
import { createClient } from "bedrock/client";
import { BedrockProvider, useQuery, useMutation, useUser, useUpload } from "bedrock/react";
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

All hooks need BedrockProvider. `useQuery` returns `{ data, error, isLoading }`;
`useMutation` returns `{ mutate, error, isPending }`; `useUser` returns
`{ user, isLoading }`; `useUpload<typeof pebble>("attachments")` returns
`{ upload, progress, error, isUploading }`. Args without a schema are `undefined`.
HTML references `./app.tsx` with a module script; Bun bundles it.

`@bedrock/ui` exports Onyx primitives (Button, Input, Textarea, Panel/PanelBody,
Dialog, Table, Tabs, Toast, and more) and AppShell, UserMenu, SignInGate,
UploadButton. Import its stylesheet once; no Tailwind setup is needed.
`UploadButton<typeof pebble>` takes `bucket="attachments"` and
`onUpload={metadata => ...}`, with optional `accept`, `disabled`, `label`,
`onError`, `onUploadingChange`. It uploads immediately; link the returned id in
a mutation and clean up abandoned files. Pass the provider's client to auth UI.
Set `document.documentElement.dataset.theme` to `"light"` or `"dark"`; use normal
CSS for app layouts. The bundled CSS includes utilities used by components only.

## Host operations and backups

From `packages/bedrock`, `bun link` registers the `bedrock` bin globally. Ensure
Bun's bin directory is on PATH. `bedrock --version` prints the package version.
All commands support `--json` (one object; doctor returns a checks array).
Errors carry `code`, `message`, `hint`; failures set exit code 1.

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
bedrock self-update        # git pull --ff-only, bun install, service restart
bedrock backup run
bedrock backup ls notes --json
bedrock backup restore notes --at 2026-10-06T03:00:00.000Z --yes
bedrock doctor --json
bedrock token ls --json
bedrock logout
```

The daemon runs all pebbles on private localhost ports, proxies hostnames, enforces
access/Origin and supervises crashes. `$BEDROCK_HOME` defaults to `~/.bedrock`.
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
(`loginctl enable-linger "$USER"` for boot without login).

Remote CLI credentials live in XDG_CONFIG_HOME/bedrock/credentials.json or
~/.config/bedrock/credentials.json, mode 0600. Precedence: explicit flags, env
BEDROCK_URL/BEDROCK_TOKEN, reachable local daemon, saved remote credentials.
Remote operational commands accept `--url`/`--token`. Backup setup is server-local;
run it on the home server. R2 setup prompts for the secret when omitted, or accepts
`--r2-secret-access-key`. Credentials are in `$BEDROCK_HOME/backup-credentials`,
mode 0600, separate from non-secret `config.json`. No R2 request is made by setup.

Backups run on daemon startup when due, then check each minute. Defaults:
intervalMinutes=60, hourly=24, daily=30. Configure setup with
`--interval-minutes 60 --keep-hourly 24 --keep-daily 30`, or edit `config.backup`:

```json
{ "type": "fs", "directory": "/mnt/external/bedrock", "intervalMinutes": 60, "hourly": 24, "daily": 30 }
```

R2 config uses `type: "r2", account, bucket` plus the same scheduling/retention
fields. The endpoint is `https://<account>.r2.cloudflarestorage.com`.
Native S3 listing is used when available; Bun 1.2 uses a dependency-free
SigV4 ListObjectsV2 fallback. Built-in targets implement async `{ put, get, exists, list, delete }` using
Bun.S3Client or filesystem; no Litestream/restic. The target directory should be
outside BEDROCK_HOME, on another disk for disk-failure protection.

Object layout:

```text
pebbles/<name>/db/<ISO timestamp>.sqlite.gz
pebbles/<name>/files/<SHA-256>
pebbles/<name>/manifests/<ISO timestamp>.json
daemon/db/<ISO timestamp>.sqlite.gz
daemon/manifests/<ISO timestamp>.json
```

SQLite is snapshotted consistently with VACUUM INTO while live, then gzipped.
Files use metadata SHA-256 and upload only if absent. Manifest contains timestamp,
db key/checksum, file id→SHA-256, package version and migration name/hash list.
Manifests publish last. Retention keeps the newest snapshot per hour/day (UTC)
and collects blobs unreferenced by retained manifests. Failed uploads may leave
orphans until the next successful pruning pass. A concurrent file deletion may
fail a live snapshot; the daemon logs it and retries at the next interval.

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

Daemon API (Bearer creator deploy token): GET `/api/pebbles`, GET `/api/status`,
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

## Common mistakes

- Importing `pebble.ts` as a runtime value in browser code bundles server code.
  Use `import type pebble` and type the client/hooks.
- Forgetting `schema` or `storage` registration. Register plugin tables through
  `plugins`, normal tables through `schema`, and exact bucket objects through `storage`.
- Treating sign-in as row authorization. Filter/check ownership in every handler;
  a plugin route is no exception.
- Assuming a job has a user. It runs with `null`; choose storage policies accordingly.
- Raw SQL writes without invalidation, or raw SQL query reads without tracking.
  Prefer Drizzle; pass table objects to invalidate, or SQL table names rather
  than schema export keys.
- Returning BigInt or executing transaction-control SQL in a handler/migration.
  Return JSON-compatible values and let Bedrock own transaction boundaries.
- Editing applied migrations, skipping generation for plugin tables, or putting
  runtime dependencies only in devDependencies. Commit new migrations and put
  production dependencies in dependencies.
- Hooks outside BedrockProvider, missing @bedrock/ui/styles.css, or assuming the
  shipped stylesheet generates arbitrary consumer Tailwind classes.
- Replaying an uncertain mutation or assuming jobs provide exactly-once delivery.
  Use idempotent application operations. Job overlap protection is process-local;
  a deploy handoff can briefly have two schedulers.
- Expecting rollback to undo schema/data or a backup to contain release code.
  Keep source/config backups too, inspect migrations, and test restores.
- Testing against ~/.bedrock or real Cloudflare/R2. Use temp directories and mocks.
