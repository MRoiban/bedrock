# Working on bedrock

Read `ARCHITECTURE.md` first. It is the contract. If you think it is wrong, say so
in your final report instead of silently diverging.

## Conventions

- Bun ≥ 1.2, TypeScript strict, ESM only. Prefer Bun built-ins (`bun:sqlite`, `Bun.serve`, `Bun.file`) over packages.
- New runtime dependencies need a one-line justification in your report. Allowed today: `drizzle-orm`, `drizzle-kit` (dev/CLI), `arctic`, `@standard-schema/spec` (types only). Ask before adding anything else.
- Small files, small functions, no clever abstractions. Code should read like it was written by one careful person.
- Comments explain *why*, never *what*.
- Errors: throw `BedrockError(code, message, hint)` for anything a user or agent can hit.
- Never touch `$HOME/.bedrock` in tests; use a temp `BEDROCK_HOME`.

## Verification (required before reporting done)

```sh
bun install
bun run typecheck
bun test
```

All three must pass. Tests use `bun test`, live next to code as `*.test.ts`, and
e2e tests that start real servers go in `packages/bedrock/test/`.

## Commits

One commit per task, conventional style (`feat(db): ...`). Do not push.
