# Bedrock

A personal cloud built with Bun and SQLite. Phase 1 provides pebble configuration,
typed functions, migrations, table tracking, a local HTTP runtime, and a small CLI.
See [ARCHITECTURE.md](ARCHITECTURE.md) for the full contract and
[package guide](packages/bedrock/AGENTS.md) for the implemented API.

```sh
bun install
bun run typecheck
bun test

cd examples/notes
bun ../../packages/bedrock/src/cli/index.ts dev
```

Open the printed URL to add and list notes. The local development worker enables
the explicit insecure identity flag and the example lets you choose an identity.
Data stays in the example's ignored .bedrock/ directory.

Create a pebble with `bedrock init <name>`, then `bun install` in that directory.
Install `drizzle-kit` as a development dependency for `bedrock db generate`.
Commit generated SQL and metadata. `db plan` previews pending SQL; `db migrate`
and `dev` apply it. All commands support `--json`.

Later phases add the daemon, authentication, sync, storage, and hosting. Web pages
and escape-hatch routes are public in Phase 1; function APIs enforce configured
users/email access. The runtime only binds localhost.
