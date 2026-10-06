# Bedrock

One home server for your small projects, called **pebbles**. Bun runs each pebble
in its own process; SQLite and files stay on your disk. Google login, live queries,
uploads, jobs, plugins, backups, and a Cloudflare Tunnel come built in.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the contract and
[the author API reference](packages/bedrock/AGENTS.md) when building a pebble.
Creators are trusted: separate processes provide no OS sandbox. Access policies,
signed identity, and Origin checks protect against end users and the internet.

## Getting started

Use a domain whose DNS is managed by Cloudflare. On your home server:

```sh
git clone <repo> ~/.bedrock/src && ~/.bedrock/src/install.sh
bedrock setup
```

The installer checks Bun ≥ 1.2, installs the checkout and puts `bedrock` in Bun's
bin directory. Add `~/.bun/bin` to PATH if needed. Setup walks through Cloudflare
browser authorization, your domain and creator email, Google sign-in, backups,
and automatic startup. It finishes by checking the server and your creator login.
Google and backups can be deferred; public pebbles work without Google.

Install the CLI on your laptop with the same checkout installer, then:

```sh
bedrock login example.com
bedrock new my-app && cd my-app
bedrock dev
bedrock deploy
```

`new` defaults to the React notes starter. It installs dependencies, generates
migrations, and creates the first Git commit. Open `http://my-app.localhost:3000`;
dev offers an email-picker login without Google credentials. Edit `pebble.ts` or
`web/app.tsx`, then stop dev with Ctrl-C and deploy. Deploy prints and opens
`https://my-app.example.com`. The React starter permits anyone signed in with
Google; use `access: "creators"` to limit it to server creators.

Use `bedrock new hello --template minimal` for a public HTML starter, or
`bedrock init hello` to scaffold in the current empty directory. Source installs
use local `file:` dependencies for the workspace packages until they are published.
The daemon replaces these first-party dependencies with its own installed packages
on deployment. Commit `migrations/`, including `meta/`.

Setup saves its checklist in `$BEDROCK_HOME/setup.json`. Rerun `bedrock setup`
to resume after a failure. Use `bedrock setup --status`, or redo a single step:
`bedrock setup google`, `bedrock setup backups`, `bedrock setup identity`.
Configuration changes invalidate service/verification; identity changes also
invalidate tunnel configuration. Rerun the full setup to apply those changes.

## Non-interactive setup (agents)

Every prompt has a flag. With redirected stdin, `--yes`, or `--json`, setup never
prompts. Missing choices produce a `BedrockError` listing the missing flags before
setup changes anything. For an unattended server, use an API token with Zone: Read,
DNS: Edit and Cloudflare Tunnel: Edit permissions. Account and zone IDs are discovered:

```sh
CLOUDFLARE_API_TOKEN=YOUR_TOKEN bedrock setup --yes --json \
  --domain example.com --creator you@example.com --port 3000 \
  --google-client-id YOUR_ID.apps.googleusercontent.com \
  --google-client-secret YOUR_SECRET --dir /mnt/backup/bedrock --skip-sign-in
bedrock setup --status --json
bedrock setup verify  # complete creator browser sign-in later
```

Choose `--skip-google` and/or `--skip-backups` to defer them. R2 flags are
`--r2-bucket`, `--r2-access-key-id`, `--r2-secret-access-key`, and optionally
`--r2-account`; the account is discovered when an API token is available.
`--install-cloudflared` authorizes package installation (Homebrew on macOS,
Cloudflare's Debian/Ubuntu repository on Linux). Other Linux distributions should
install the [official package](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) first.
`--enable-linger` authorizes Linux startup without login. `--skip-sign-in` defers
only the final browser check; doctor still runs.

`bedrock self-update` pulls the checkout with `git pull --ff-only`, installs updated
dependencies, and restarts an installed service. Keep the checkout in place.

## Jobs and live queries

Use Drizzle for job and route writes. With an `items` table whose `expiresAt`
column stores epoch milliseconds, a cleanup job looks like:

```ts
import { job, lt } from "bedrock";

// Inside definePebble({ schema: { items }, sync: true, ... }):
jobs: {
  prune: job("0 3 * * *", ctx => {
    ctx.db.delete(items).where(lt(items.expiresAt, Date.now())).run();
  }),
},
```

Writes through `ctx.db` in jobs, mutations, and custom routes are tracked
and notify live queries automatically after commit. `invalidate()` is only
needed for raw SQL via `$client` or writes outside bedrock; notify external
writes from a mutation, job, or route. Prefer registered Drizzle table objects
(`ctx.invalidate([items])`); SQL names (`ctx.invalidate(["items"])`) also work.
See the [author reference](packages/bedrock/AGENTS.md#live-queries-and-explicit-invalidation)
for the raw SQL escape hatch.

## Operations

```sh
bedrock whoami
bedrock status
bedrock logs hello -f
bedrock jobs ls hello --json
bedrock jobs run hello prune
bedrock backup run hello
bedrock backup ls hello --json
bedrock backup restore hello --at 2026-10-06T03:00:00.000Z --yes
bedrock rollback hello
```

Backups run in the daemon (default every 60 minutes). They use consistent SQLite
`VACUUM INTO`, gzip, SHA-256 file deduplication, and manifests. Retention keeps the
newest snapshot in each of 24 hours and 30 UTC days; unreferenced file blobs are
collected. Adjust with setup flags `--interval-minutes`, `--keep-hourly`,
`--keep-daily`, or the `backup` section of `$BEDROCK_HOME/config.json`.

Restore stops the pebble, verifies the database and every file, swaps its data
directory, keeps `data.before-restore-<timestamp>-<suffix>`, then starts the current
code (which applies any newer migrations). Rollback refuses code missing already
applied migrations; `--force` overrides that guard. To recover an older schema,
stop the pebble, select compatible code with a forced rollback, then restore its
matching snapshot. Do not treat code rollback as database rollback.

`$BEDROCK_HOME` defaults to `~/.bedrock`. Protect that directory and back up your
source code/configuration separately: data snapshots include pebble DBs/files and
the daemon DB, but exclude releases, OAuth settings, and credential files. Daemon
DB recovery is an offline operation; the pebble restore command does not replace
identity state. See the author reference for the backup object layout.

## Repository checks

```sh
bun install
bun run typecheck
bun test
```

Tests use temporary data directories and mocked Cloudflare services; they do not
contact real R2 or install a host service.
