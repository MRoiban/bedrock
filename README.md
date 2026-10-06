# Bedrock

One home server for your small projects, called **pebbles**. Bun runs each pebble
in its own process; SQLite and files stay on your disk. Google login, live queries,
uploads, jobs, plugins, backups, and a Cloudflare Tunnel come built in.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the contract and
[the author API reference](packages/bedrock/AGENTS.md) when building a pebble.
Creators are trusted: separate processes provide no OS sandbox. Access policies,
signed identity, and Origin checks protect against end users and the internet.

## Five-minute quickstart (from this checkout)

Install Bun ≥ 1.2, then run from the repository root:

```sh
bun install
(cd packages/bedrock && bun link)
bedrock --version
bedrock init hello
cd hello
bun link bedrock
bun install
bedrock dev
```

`bun link` in `packages/bedrock` registers its `bedrock` bin globally. Put Bun's
bin directory (`~/.bun/bin` by default) on PATH. `bun link bedrock` in the generated
project uses this checkout instead of a registry release. Once packages are
published, `bun add --global bedrock` and a normal `bun install` suffice.

Open `http://hello.localhost:3000`. Edit `pebble.ts` or `web/index.html`; dev restarts
on edits and keeps data in `.bedrock/`. Protected pebbles offer a local email-picker
login with no Google credentials. Stop dev with Ctrl-C.

Deploy locally, using a second terminal for the daemon:

```sh
bedrock setup --domain localhost --creator you@example.com
bedrock daemon
```

From `hello/` in another terminal:

```sh
bedrock deploy
bedrock ls --json
```

For the React notes starter, register the UI package too with
`(cd packages/ui && bun link)` from the repository root. Run
`bedrock init notes --template react`, then in `notes/` run `bun link bedrock`,
`bun link @bedrock/ui`, `bun install`, `bun add --dev drizzle-kit`,
`bedrock db generate`, and `bedrock dev`. Commit `migrations/`, including `meta/`.
The starter includes live queries, owner-only attachments, and Onyx UI components.

## Home-server go-live checklist

Use a stable checkout and a domain whose DNS is managed by Cloudflare. Install Bun
and `cloudflared` on the server; no backup binary, container, or reverse proxy is
needed. Register the CLI with `bun link` from `packages/bedrock` after `bun install`.
Stop any manually running daemon before installing its service.

1. Set a public domain, fixed port, creators, and Google OAuth credentials. Configure
   Google's redirect URI as `https://auth.example.com/callback`.
2. Set up the tunnel with a transient Cloudflare API token granting Cloudflare
   Tunnel: Edit and DNS: Edit. Only its run token is saved.
3. Configure backups to an external disk or R2. Keep backup credentials private;
   R2 credentials live in a separate mode-0600 file.
4. Install the service, deploy a pebble, run a full backup and doctor, and test a
   restore on a disposable pebble before relying on backups.

```sh
bedrock setup --domain example.com --creator you@example.com --port 3000 \
  --google-client-id YOUR_CLIENT_ID --google-client-secret YOUR_CLIENT_SECRET
bedrock tunnel setup --account-id ACCOUNT_ID --zone-id ZONE_ID
bedrock backup setup --dir /Volumes/backup/bedrock
# Alternative (the secret is prompted without echo):
# bedrock backup setup --r2-account ACCOUNT_ID --r2-bucket BUCKET --r2-access-key-id KEY_ID
bedrock service install --dry-run
bedrock service install
bedrock service status --json
bedrock deploy ./hello
bedrock backup run
bedrock doctor --json
```

Linux uses a systemd user service; `loginctl enable-linger "$USER"` allows startup
without login. macOS uses a LaunchAgent and starts at user login. Services use
absolute Bun/CLI paths, so keep that checkout in place. Restart the service after
tunnel configuration changes. No Cloudflare changes are needed for new pebbles.

From your development machine, `bedrock login --url https://bedrock.example.com`
opens creator approval in the browser. Then `bedrock deploy` uploads the current
project. `bedrock logout` revokes that credential. Deploy tokens grant full daemon
management access. All commands accept `--json`; errors include repair hints.

## Operations

```sh
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
