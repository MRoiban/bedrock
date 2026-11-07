# Work log

## Now
Goal: Built-in observability, alerting and `bedrock test`, plus a monitoring pebble, per the owner-approved design (`docs/design/observability/DESIGN.md`, reports 01–04 beside it). Build order: telemetry store + status/metrics/logs → readiness, job deadlines, incidents, alert outbox → `bedrock test` → error tracking (after source maps) → monitoring pebble + off-box watcher kit.
State: Planning only; no code written. `main` at 225958e (PR #7 merged, same code as fe93675, which the research was grounded in). Live host `~/.bedrock/src` runs fe93675.
Next: Send the owner a short plan with milestones, then start milestone 1 on a feature branch with GPT-6.1-sol sub-agents (at most 5).
Don't: Use Opus sub-agents. Push or make any repo public beyond the owner-approved monitoring fork without asking. Touch `$HOME/.bedrock` in tests.

## Gotchas
- Run tests with `TMPDIR` on `/dev/shm`: `/tmp` is a small tmpfs and causes bogus ENOSPC — repeated test failures, 2026-11-02.
- Two socket backpressure tests fail on `main` regardless of changes ("real daemon keeps an unconfigured application burst alive…", "real daemon closes application sockets only when…") — reproduced on several branches.
- Pilot pebbles comms, typewriter and babel live under `~/.bedrock/pebbles/`, not `/data/bedrock/pebbles/` — `ls` on 2026-11-07.

## Log
- 2026-11-07 19:10 [claude]: read DESIGN.md and checked it against the checkout → `main` 225958e matches fe93675 code; dev launcher still hard-codes `.bedrock/daemon` and watches the source (`packages/bedrock/src/cli/dev.ts:9,92`); comms exposes `/api/v1/messages` (`src/api.ts`).
