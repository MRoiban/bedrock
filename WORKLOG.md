# Work log

## Now
Goal: Built-in observability, alerting and `bedrock test`, plus a monitoring pebble, per the owner-approved design (`docs/design/observability/DESIGN.md`, reports 01–04 beside it). Build order: telemetry store + status/metrics/logs → readiness, job deadlines, incidents, alert outbox → `bedrock test` → error tracking (after source maps) → monitoring pebble + off-box watcher kit.
State: Owner approved the plan (M0 pick fork, M1 telemetry, M2 health/alerts via generic webhook outbox, M3 bedrock test, M4 errors, M5 monitoring pebble). Branch `feat/observability` (e8336f9) holds design docs. M0, M1, M3 delegated to GPT-6.1-sol (xhigh) in worktrees. Live host runs fe93675.
Next: Review each agent's commit, cherry-pick onto `feat/observability`, run full suite, Rottweiler, deploy, compare against the M1 baseline below. Then M2 and M4.
Don't: Use Opus sub-agents. Push or make any repo public beyond the owner-approved monitoring fork without asking. Touch `$HOME/.bedrock` in tests.

## Gotchas
- Run tests with `TMPDIR` on `/dev/shm`: `/tmp` is a small tmpfs and causes bogus ENOSPC — repeated test failures, 2026-11-02.
- Two socket backpressure tests fail on `main` regardless of changes ("real daemon keeps an unconfigured application burst alive…", "real daemon closes application sockets only when…") — reproduced on several branches.
- Pilot pebbles comms, typewriter and babel live under `~/.bedrock/pebbles/`, not `/data/bedrock/pebbles/` — `ls` on 2026-11-07.

## Log
- 2026-11-07 19:10 [claude]: read DESIGN.md and checked it against the checkout → `main` 225958e matches fe93675 code; dev launcher still hard-codes `.bedrock/daemon` and watches the source (`packages/bedrock/src/cli/dev.ts:9,92`); comms exposes `/api/v1/messages` (`src/api.ts`).
- 2026-11-07 19:25 [claude]: owner said go; created `feat/observability` e8336f9 (design docs + log); delegated M0 (fork research), M1 (telemetry), M3 (bedrock test).
- 2026-11-07 19:30 [claude]: live baseline before M1, hut via proxy, 3000 req at concurrency 10 → p50 3.0–3.2 ms, p99 8.8–10.8 ms, ~2,820 req/s, daemon CPU 0.41–0.42 s per 1k requests (evidence: scratchpad bench.ts, 2 runs).
- 2026-11-07 [claude]: M0 done → recommends forking Gatus (Apache-2.0): port selected Vue status UI to React, rewrite the Go backend as a Bun/Drizzle pebble, est. 10–16 dev-days; off-box = small Upptime-style Actions prober + static export in the public fork, plus Cloudflare Tunnel Health Alert; public page should show only aggregate "Home cloud", no pebble names. Cherry-picked as 4783f6c. Owner choices deferred to M5: canary hostname, notification destination/watchdog, retention, accepting the porting scope.
