# Bedrock — Architecture

Bedrock is a personal cloud. One home server hosts many small projects called
**pebbles**, each reachable at `https://<pebble>.<domain>`. Fewer than 10 people
create pebbles; each pebble serves at most ~1,000 users.

This file is the contract: what Bedrock is, what it refuses to be, and the rules
for changing it. It stays short on purpose. Exact behavior (endpoints, limits,
retry schedules, file formats) lives in [docs/reference.md](docs/reference.md),
in the code, and in the tests. If this file and the reference disagree, this file wins;
if the reference and the code disagree, fix one of them in the same change.

## 1. Ethos

In priority order: **simple, lightweight, modular, extensible, agent-friendly.**

- **Simple** — one way to do each thing. A new concept must replace or clearly
  outweigh the concepts a pebble author already has to learn.
- **Lightweight** — one Bun process for the daemon, one per pebble, one SQLite file
  per pebble. No Postgres, Redis, Docker, reverse proxy, or external backup tools.
- **Modular** — modules talk through exported TypeScript interfaces only.
- **Extensible** — through plain TypeScript (pebbles import and spread modules) and
  escape hatches (routes, detached work, raw SQL), not through a framework of hooks.
- **Agent-friendly** — everything is a file an agent can read, a command with
  `--json`, or an error with a repair hint.

Every dependency must be small and must not own our data model.

## 2. Non-goals

Bedrock is a foundation, not a platform. It does not and will not:

- Isolate pebbles from each other or from their creators (see §8 Trust model).
- Run arbitrary containers, languages other than Bun/TypeScript, or multiple hosts.
- Act as a control plane: fleet management, agent hosting, CI, or workflow
  engines belong in pebbles that use the daemon API, not in the daemon.
- Provide a plugin or middleware framework. Share code by importing it.
- Offer per-feature configuration knobs nobody has asked for twice.
- Provide row-level diffs, optimistic updates, or caches shared across clients
  (deferred until a real pebble needs them).

## 3. Rules for growth

1. **Two pebbles before core.** A new primitive enters Bedrock only when two real
   pebbles need it, or one needs it and cannot reasonably build it on what
   exists. Until then it lives in the pebble.
2. **Defaults over options.** Prefer behavior that is right without
   configuration (seamless reloads, reconnects, caching) to a new option.
3. **Each concept once.** One response envelope (`{ ok, value }` /
   `{ ok: false, error: { code, message, hint } }`), one control channel from
   daemon to pebble (IPC), one way to deliver credentials to a pebble (secrets).
4. **The contract stays short.** New detail goes to `docs/reference.md`, never
   here. This file changes only when a principle, non-goal, or core concept does.
5. **Removal is a feature.** Unused surface (no real pebble uses it) is a
   candidate for deletion, as plugins were.

## 4. Stack

| Concern      | Choice |
|--------------|--------|
| Runtime      | Bun ≥ 1.2 (`bun:sqlite`, `Bun.serve`, WebSockets) |
| Database     | SQLite (WAL), one file per pebble |
| Schema / SQL | Drizzle ORM, re-exported not wrapped; drizzle-kit generates migrations, Bedrock applies them |
| Validation   | Any [Standard Schema](https://standardschema.dev) library; no hard dependency |
| Auth         | Google OAuth via `arctic`; sessions in our own SQLite |
| Sync         | Our own reactive queries over WebSocket |
| Storage      | Local filesystem behind a driver interface |
| Network      | Cloudflare Tunnel (`cloudflared`), the only external host dependency |
| Backups      | Built-in `VACUUM INTO` + gzip + content-addressed files → disk or R2 |

Hosts: macOS, Linux, and native Windows 11 (no WSL).

## 5. Shape

```
internet ─ Cloudflare Tunnel ─ daemon (127.0.0.1) ─┬─ pebble process "notes"  ─ data/db.sqlite, files/
                                                   ├─ pebble process "safe"   ─ ...
                                                   └─ auth.<domain>, bedrock.<domain> (dashboard + API)
```

- The **daemon** owns identity (users, sessions, deploy tokens in
  `bedrock.sqlite`), routes by `Host`, proxies HTTP and WebSockets, supervises one
  Bun subprocess per pebble, deploys releases with health-gated zero-downtime
  swaps, runs backups, and supervises `cloudflared`.
- A **pebble process** (`startPebble`) owns its own SQLite file, files, jobs,
  sockets, and services. It never opens another pebble's data.
- **Identity is global, authorization is per pebble.** The daemon resolves the
  session and forwards a signed identity to the child; the child enforces the
  pebble's access policy. Pebble tokens let native and scripted clients act as a
  user on one pebble.
- **The daemon talks to children only over IPC**; children reach the daemon API
  only with an explicit bearer token.
- **Children see only what they are given:** an allow-listed host environment,
  their own secrets, and reserved `BEDROCK_*` values.

## 6. The pebble contract

A pebble is a directory with a `pebble.ts` default-exporting `definePebble(...)`.
That file is the single source of truth an agent reads to understand a pebble.

```ts
import { definePebble, query, mutation, sqliteTable, text, eq } from "bedrock";
import * as v from "valibot";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id").notNull(),
  body: text("body").notNull(),
});

export default definePebble({
  name: "notes",
  access: "users",
  schema: { notes },
  sync: true,
  queries: { mine: query(({ db, user }) => db.select().from(notes).where(eq(notes.ownerId, user!.id))) },
  mutations: { add: mutation(v.object({ body: v.string() }), ({ db, user }, { body }) =>
    db.insert(notes).values({ ownerId: user!.id, body }).returning()) },
  web: "./web/index.html",
});
```

The concept budget a pebble author learns, and nothing more:

| Concept | Purpose |
|---------|---------|
| `schema` | Drizzle tables; migrations generated from them |
| `query` / `mutation` | Typed, validated functions in read / write transactions; the client infers their types |
| `access` | `public`, `users`, `creators`, or an allow-list |
| `sync` | Live queries: subscriptions re-run when the tables they read change |
| `bucket` / `storage` | Files with access policies, chunked and resumable uploads |
| `routes` / `detached` | Plain Bun handlers; `detached` for slow network I/O outside the write queue |
| `job` | Five-field cron in the pebble's write queue (or detached) |
| `socket` / `service` | Application WebSockets and long-lived in-process resources |
| `tokens` | Per-user bearer tokens for native and scripted clients |
| `backup.directories` | Opt plain data trees into backups |

All SQLite writes go through one serialized queue per pebble. Network I/O never
happens inside a queue slot.

## 7. Clients

`bedrock/client` is framework-agnostic; `bedrock/react` is a thin layer of hooks
over it. The client hides deploys, restarts, and lost connections: a save
resolves only after the UI that depends on it has its new data, stale tabs reload
themselves when safe and restore their place, and the client falls back from
WebSocket to HTTP polling and back without the app noticing. `@bedrock/ui` is an
optional, separate React component package.

## 8. Trust model

Creators are trusted. Pebbles are separate processes with no OS isolation and can
access server resources as the daemon user. Security boundaries protect against
end users and the internet, not hostile creators: signed identity, Origin checks,
access policies, hashed credentials, least-privilege scoped deploy tokens, and
credentials kept out of other pebbles' environments.

## 9. Agent-friendliness (non-negotiable)

- Every CLI command supports `--json` (one JSON value on stdout) and is idempotent.
- Errors are `BedrockError(code, message, hint)`; the hint says how to fix it.
- `bedrock dev` runs the full stack locally with fake auth; agents can test auth
  flows without credentials.
- The package ships `AGENTS.md` (the complete author guide) and `llms.txt` (a short index).
- Destructive commands require `--yes`.
