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
  Runs an embedded daemon plus a private pebble child at http://<name>.localhost:<port>.
  Protected pages redirect to /_bedrock/dev-login; pick any email and optional name.
  Dev cookies are HttpOnly and host-only: browsers reject Domain=.localhost.
  auth.localhost/login?return=<pebble URL> redirects to the host-local form.
  Dev mode requires an explicit startDaemon dev flag and a localhost domain/config.
  Production daemons never read a dev-mode environment switch.
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
- Storage and plugins are config helpers, with no implementation.
  The daemon gates every pebble route using access from the child's health check.
  Access: public, users, creators (config.json emails), or { allow: [email, "@domain"] }.
  Runtime functions and sync also verify signed identity and enforce access.
- createClient({ url? }) from bedrock/client supports query, mutate, subscribe,
  user() -> User | null, loginUrl(returnTo?) -> string, logout() -> Promise<void>, close().
  Browser sessions travel as cookies automatically. React provides useUser() ->
  { user, isLoading }, useQuery, useMutation and BedrockProvider.
  Non-browser writes and WebSocket upgrades must send the pebble's exact Origin.
- Sync reruns subscriptions for each socket's user after committed writes.
  Logout closes that session's sockets; expiry/revocation is checked every five minutes.

Table tracking matches known schema table identifiers in executed Drizzle SQL and
conservatively over-records reads. It does not observe direct db.$client calls,
implicit trigger writes, or foreign-key cascades; these need handling before sync.

## Daemon (Phase 2)

```sh
bedrock setup --domain localhost --creator you@example.com
bedrock daemon
bedrock deploy ./hello
bedrock ls --json
bedrock logs hello -f
bedrock rollback hello
bedrock rm hello --yes
```

- startDaemon({ home, port, domain }) from bedrock/daemon returns { server, home, stop }.
  Run setup first. It listens on 127.0.0.1; each pebble is a separate Bun subprocess.
- Hosts: <name>.<domain> and <name>.localhost route to pebbles. bedrock hosts route
  to the daemon API; auth hosts serve login/callback/logout/me; www is reserved. HTTP and generic WebSockets proxy.
- Runtime dependencies must be in dependencies, not devDependencies. The daemon
  installs production deps and symlinks its own bedrock package into every release.
  Archives must contain regular files/directories only, with pebble.ts at the root.
- setup is idempotent and preserves existing config. daemon writes admin-token
  (0600) and daemon.json in BEDROCK_HOME. Tokens are SHA-256 hashed in SQLite.
- CLI connection precedence: --url/--token, BEDROCK_URL/BEDROCK_TOKEN, local home.
  token create prints a fresh deploy token once. start/stop/restart manage processes.
- API (Bearer deploy token required): GET /api/pebbles; POST /api/tokens;
  POST /api/deploy?name=<name> (tar.gz body); GET /api/pebbles/<name>/logs[?follow=true];
  POST /api/pebbles/<name>/start|stop|restart|rollback;
  DELETE /api/pebbles/<name>?confirm=true (removes releases, data, and logs).
- Deploy health-checks a candidate before swapping current and routing; keeps three
  releases. Rollback switches code, not data: migrations must remain compatible with
  the previous version. Runtime GET /_bedrock/health is reserved for readiness.
- Logs rotate at 10 MB, keeping three older files. --json logs -f streams one JSON
  object which completes when interrupted; parse it after the stream ends.
- Incoming x-bedrock-*
  headers are stripped. Auth/user pebbles require Phase 3; use public pebbles now.

## Authentication (Phase 3)

```sh
bedrock setup --domain example.com --creator you@example.com \
  --google-client-id <id> --google-client-secret <secret>
```

- Configure Google's redirect URI as https://auth.<domain>/callback.
  Repeating setup adds/updates Google credentials while preserving existing config.
- Production login: auth.<domain>/login?return=https://<pebble>.<domain>/.
  Google OAuth uses PKCE and browser-bound, single-use state with a __Host- cookie. Only verified emails
  create users. Identity is global; the daemon stores SHA-256 session hashes.
- Sessions expire after 30 days, slide at most once daily, and use HttpOnly, Secure,
  SameSite=Lax parent-domain cookies. Dev uses host-only cookies without Secure.
- The daemon strips internet x-bedrock-* headers and bedrock_session cookies,
  forwards JSON identity with a timestamp/HMAC, and prevents pebble responses from
  setting bedrock_session. The per-boot signing secret is supplied only via child env.
  Runtime rejects missing signatures, tampering and timestamps older than 60 seconds.
- POST /_bedrock/logout on the pebble host is the SDK's same-origin logout endpoint;
  GET /_bedrock/me returns { user } even when the pebble requires authentication.
- Sibling origins cannot write or upgrade WebSockets. No Origin also fails for writes.
  WebSocket-only activity does not extend session expiry; make an HTTP request to slide it.
