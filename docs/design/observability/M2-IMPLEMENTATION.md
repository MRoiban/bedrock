# M2 implementation and evidence

Base: `0e42da5`. No runtime dependencies, live API calls, deployed changes,
secrets-file reads, WORKLOG.md edits, or subagents. Read-only comms grounding:
`~/.bedrock/pebbles/comms/releases/1792500971648-87565677/{src/api.ts,client/openapi.ts}`,
plus message routing/idempotency, dispatcher and quiet-hour implementation.
The receiver supports per-client bearer tokens, payload idempotency keys,
normal/high/low urgency, and explicit Poke/ntfy/email channels.

## Decisions and implementation

- Child readiness uses the existing IPC control channel. It checks that startup
  migrations completed, SQLite schema can be read, and every declared service
  started, including deferred exclusive services. Health remains liveness.
  Existing running children are probed every 30 s, concurrency two, timeout 2 s,
  no overlap or activity reset. Idle stays available on demand; hibernation
  remains running. Check hysteresis is three failures/two successes; pages wait
  two minutes unless the supervisor already reports a crash loop.
- The only public endpoint is the daemon-host `/healthz`: exact versioned body,
  no authentication/redirect/cache, fixed small body and bounded registry read.
- Critical jobs are selected by existing pebble/job names in host config:
  `alerts.criticalJobs`. This adds no pebble-facing primitive or `job()` option,
  so no §3 two-pebble exception is needed. Expected local cron occurrences are
  persisted independently of execution events; start grace 5 min, runtime 10 min,
  no killing/replay, one episode per missing job across a restart gap. Pending
  starts are interrupted on process death or daemon restart.
- Retained pages: configured cloudflared process absent; desired-running
  readiness prolonged/crash loop; explicitly critical job failure/deadline;
  per-target backup age >2 intervals. Ordinary failures/skips enter digests.
  Trimmed **delivery-failure paging**: a broken transport cannot page through
  itself. Instead it gets a persisted local incident and one stderr repair
  notice after 10 min. The external watcher remains necessary.
- Incidents precede notification: stable host/pebble/rule/job fingerprints,
  transactionally paired opening/resolution outbox rows, 30 s grouping window,
  tunnel inhibition of child readiness only, expiring exact silences. Grouping
  batches eligible transitions; it does not merge several incidents into a new
  combined payload. Old open incidents take precedence over recent resolutions.
- A separate `alerts.sqlite` Worker isolates durable monitoring policy/outbox
  state from M1's disposable, lossy telemetry budgets. This deliberately differs
  from the design's single-observability-file proposal: telemetry eviction,
  SQLITE_FULL/recovery or retention must not remove pending alerts. SQLite uses
  FULL synchronization, a 64 MiB page cap, WAL checkpoints, 1,000 pending-row
  admission, 30 days/100,000 job events and 365 days of resolved incident/outbox
  history. A full outbox rolls back the new transition for reevaluation; no
  pending row is evicted. There are no new serving-path SQLite writes.
- `alerts.webhook` and an atomic 0600 `alerts-secret` file configure generic
  delivery. The default URL/payload target comms, but the daemon imports no
  comms code and sends no requests to the live installation. Retries preserve
  payload/key across restart. Any 2xx is receiver acceptance, not proof of
  downstream provider delivery/acknowledgment. Redirects fail and response bodies
  are cancelled unread. Retries back off 1 s to 6 h, with numeric Retry-After.
- Comms owns provider channels. Poke first, explicit ntfy+email after
  15 min unresolved, then reminders at least 6 h apart. Critical incident
  transitions use high urgency and bypass 23:00–07:30 Brussels quiet hours; only
  non-critical push waits. (The initial normal-urgency/all-pages quiet-hour policy
  was a design mismatch corrected by the R2 fixes below.) Weekly Monday
  08:00 server-local email digest, daily only while unresolved, persisted once
  per date. Test messages use the same durable/quiet-hours path.
- CLI/API: alerts listing/silences/outbox/test/setup, job history, readiness in
  status; JSON envelopes. Alert state/history/administration require unscoped
  creator tokens, matching existing job/host administration. Scoped status still
  filters readiness to granted pebbles. Reference and author guide are updated.

## Failure evidence

All fixtures use scratch homes. Clocks advance directly; no minute-long sleeps.
`packages/bedrock/test/alerts-daemon.test.ts` runs the real daemon and SQLite
Worker against a loopback fake receiver with injected observations/events:

- A single failed observation, idle target and ordinary failed job produce zero
  **page** rows. Ordinary failures may appear later in the scheduled digest.
- Tunnel outage, crash-loop readiness, stale daemon backup, and failed critical
  job produce exactly four opening rows. Recovery produces exactly four
  resolution rows: eight unique stored transition keys, one per episode/change.
- The 30 s window prevents premature submission. A child readiness page is held
  beneath the tunnel; backup/job evidence remains eligible. Engine tests also
  place 24 inhibited children ahead of a backup alert to prove delivery batching
  cannot starve an unrelated data alert.
- Receiver 503, >10 min clock advance, daemon shutdown/restart and receiver
  repair prove immutable payload/key reuse, pending-row durability and acceptance
  after retry. A local delivery-broken incident adds no recursive page.
- Night critical outage submits at 23:10 Brussels with high urgency; a
  non-critical test remains pending until 07:30 (corrected and rerun for R2).
- Public canary returns exact 200/body/no-store without credentials. Unscoped
  alert/history requests succeed; matching scoped-status tokens get 403 for
  those global/private endpoints. A dev daemon also works without config.json.

Engine/runtime/CLI tests additionally exercise two-minute readiness, two-success
recovery, DB/service readiness versus unchanged liveness, persisted expected
starts, over-budget runs, one restart gap/no replay, interrupted starts,
correlated scheduled/start/success/failure/overlap events, backup grace/recovery,
silence expiry, 15 min escalation, six-hour reminders, weekly/daily digest
idempotence, leap-day cron, old-open visibility, stdin-secret setup, 0600 mode,
credential-free JSON output and URL validation. A locked SQLite fixture verifies
readiness/canary reads fail promptly and restore the application busy timeout;
a 24-target sweep verifies concurrency two and no idle/stopped probes. A known
crashed/restarting registry state overrides an earlier cached ready observation.

## Probe cost on this host

Linux/Bun 1.4.3, 16 GiB laptop under concurrent test load. Reproduce from repo root:

```sh
bun packages/bedrock/test/probe-benchmark.ts
```

The script creates/cleans a scratch home on the checkout's disk and launches
**24 real children**, no jobs or services, with two concurrent readiness IPCs.
Five warm-up sweeps, then 100 compressed sweeps (2,400 probes), followed by 100
24-pebble SQLite evaluations. It asserts probes never reset child inactivity.
The measurement excludes child startup and does not contact deployed pebbles.

Raw final run (including the nonblocking lock-read guard):

```json
{"pebbles":24,"concurrency":2,"cycles":100,"probes":2400,"elapsed_ms":361.6777739999998,"parent_cpu_ms":154.101,"children_cpu_ms_at_100Hz":550,"parent_rss_before":45109248,"parent_rss_after":51617792,"worker_rss_delta":8888320,"evaluator_100_cycles_ms":457.25875300000007,"evaluator_100_cycles_cpu_ms":189.501,"rss_with_alerts":66519040}
```

Approximately **8.94 ms CPU per 24-pebble sweep**, including evaluator, or 0.0298%
of one core at the 30 s interval. Average warm IPC sweep wall time 3.62 ms,
evaluator 4.57 ms. Worker RSS increment 8.48 MiB; parent RSS grew 6.21 MiB during
the compressed probe burst (allocator/heap observation, not a per-probe retained
allocation claim). Child CPU is quantized to Linux 100 Hz ticks. These are warm
synthetic children and one contended run, not production throughput, cold HDD
page-in cost, a cgroup-hibernation latency measurement, or a long-term leak test.
An earlier RAM-filesystem run measured 3.91 ms CPU/sweep and 9.22 MiB Worker RSS;
it was replaced by the reproducible disk-backed harness above. The earlier
disk-backed capture before the lock-read guard measured 4.31 ms CPU/sweep and
9.17 MiB Worker RSS. Both earlier values were shared during implementation;
the larger final capture is the result reported here.

## Limits

Local cloudflared process presence cannot detect a disconnected connector,
DNS/TLS/edge failure or a dead host. Readiness checks local DB/service startup,
not runtime external dependency correctness. Off-box watcher setup is M5.
No real comms/provider delivery was attempted; no Windows run, deliberately full
filesystem, pinned-reader WAL stress or cold HDD probe benchmark was performed.
Acknowledgment/provider-outcome polling is not implemented: the generic webhook
contract ends at receiver acceptance. Alert state/credentials need a separate
BEDROCK_HOME backup; existing DB backups exclude them. Abrupt daemon death may
lose IPC events not yet committed; expected deadlines still detect the gap.
No disagreement with ARCHITECTURE.md; the extra monitoring file and lack of
provider-outcome polling are explicit design tradeoffs above.

## Exact verification commands and results

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun install && bun run typecheck && bun test --timeout 30000
```

Final frozen-source run: install checked 120 installs across 190 packages,
no dependency changes; typecheck exit 0. Full suite: **585 pass, 5 skip, 2 fail**,
4,814 assertions, 592 tests across 154 files, 276.39 s. Test exit 1 consists only
of the two owner-approved pre-existing failures; neither was modified/hidden:

- `real daemon keeps an unconfigured application burst alive for a paused consumer`
- `real daemon closes application sockets only when their configured output bound is exceeded`

Full output was captured at `/dev/shm/bedrock-m2-complete.log`. No
`Alerts unavailable` warning remains. The intermediate dev-config failure was
fixed by passing only resolved domain/alerts config into the Worker, rather
than requiring a production config file in dev mode. Earlier runs during
implementation completed with only the same two socket failures; one
intermediate run also caught the dev-config regression before its fix.

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun test packages/bedrock/src/daemon/alerts packages/bedrock/test/alerts-daemon.test.ts packages/bedrock/src/runtime/readiness.test.ts packages/bedrock/src/db/readable.test.ts packages/bedrock/src/jobs/events.test.ts packages/bedrock/src/cli/alerts.test.ts --timeout 30000
```

Final focused M2 run: **19 pass, 0 fail**, 143 assertions, 7 files, 800 ms.
`git diff --check` passed. `getconf CLK_TCK` returned 100; `findmnt -T . -no
SOURCE,FSTYPE` returned `/dev/nvme0n1p6 ext4`, confirming the benchmark's tick
conversion and scratch-store location. Kernel: 6.12.113+deb13-amd64.

## R2 fixes and regression evidence

R2 base: `8b12602`, branch `t3/fix-alerts-review-findings`. No new dependencies,
pebble-facing concepts, deployed changes, live comms calls, secrets-file reads,
WORKLOG edits or subagents. Comms API/OpenAPI and its quiet-hour implementation
were inspected read-only at the release path above: `urgency:"high"` bypasses
push quiet hours.

Each of the nine regression cases failed against the original M2 runtime, then
passed with the fixes. Baseline command (after `bun install`):

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun test packages/bedrock/src/daemon/alerts/regressions.test.ts packages/bedrock/src/daemon/alerts/probes.test.ts packages/bedrock/test/alerts-local.test.ts --timeout 30000
```

Baseline: **1 pass / 9 fail**, 41 assertions, 10 tests across 3 files, 373 ms
(`/dev/shm/bedrock-r2-before.log`). The existing concurrency test passed; every
R2 case failed at the defect assertion below. The first attempt needed an install
(missing arctic/drizzle-orm). An initial unindexed reconciliation run was stopped
after >50 s in synchronous SQLite; the regression now checks the query plan
before timing reconciliation, so the unfixed test fails promptly on `SCAN runs`.
The timing assertion was relaxed from 1 s to 2 s for full-suite load; the query
plan assertion is unchanged.

| Finding | Exact regression test name | Before → after / focused change |
| --- | --- | --- |
| R2-1 | `R2-1 critical opening, escalation and recovery bypass both quiet-hour gates with high urgency` | No opening submitted at night → all three critical transitions submit with high urgency; normal test stays queued. Both delivery and escalation gates exempt critical incidents. |
| R2-2 | `R2-2 default webhook wakes a local pebble through the daemon proxy without a tunnel` | Opening stays pending → accepted by a real idle scratch pebble through the daemon's actual loopback port, Host/path/bearer retained; normal Origin checks still reject an unauthenticated cross-origin POST. External URLs remain generic (separate passing regression). |
| R2-3 | `R2-3 99,999-event reconciliation for 24 pebbles uses an indexed terminal lookup below 2s` | `SCAN runs` → indexed search; 211.65 ms reconciliation in the focused evidence run. Added `(run,state)` and occurrence lookup indexes. |
| R2-4 | `R2-4 recovery waits for opening Retry-After across a store restart` | Recovery submitted before the opening retry → held across reopen until opening acceptance. Stored insertion order gates pending transitions per incident, independently of retry due times. |
| R2-5 | `R2-5 saturated outbox replays durable failure and success evaluation after restart` | Both transitions lost with 1,000 pending rows → one opening and one recovery replay after capacity returns/reopen. Terminal history insert carries a durable pending flag; condition/outbox commit and flag clearing are atomic. |
| R2-6 | `R2-6 full page budget reclaims accepted history before admitting a pending transition` | `SQLITE_FULL` → cleanup runs before evaluation and admission succeeds. Retention also runs before job events and independently during delivery; pressure reclaims non-pending history to reserve 4 MiB, protecting pending outbox/evaluation rows. Fixture deliberately fills a reduced 256-page SQLite budget, not the filesystem. |
| R2-7 | `R2-7 a successful prior occurrence cannot skip the next overdue minute` | No incident at 12:07:30 after a 12:01 success/12:02 miss → one incident, still one opening across subsequent misses. Advance/check each overdue occurrence from the old deadline instead of skipping to now. |
| R2-8 | `R2-8 a child swap during readiness preserves registered incidents and deadlines` | Swap falsely resolves readiness → starting/unknown snapshot preserves open incident/check/deadline; actual registry removal resolves it. |
| R2-10 | `R2-10 backup setup, interval changes and removal apply on the next probe sweep` | Backup setup unseen until restart → next sweep sees setup and current interval/removal. Read backup config per sweep as the backup scheduler does. |

Reference and author guide describe the corrected behavior. Existing immutable
payloads retain their original urgency when upgrading; rewriting a previously
attempted payload would violate receiver idempotency. Historical job transitions
already lost before this change have no pending marker to replay. New markers
are protected from retention and replayed in event order.

Focused M2/evidence command:

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun test packages/bedrock/src/daemon/alerts packages/bedrock/test/alerts-local.test.ts packages/bedrock/test/alerts-daemon.test.ts packages/bedrock/src/runtime/readiness.test.ts packages/bedrock/src/db/readable.test.ts packages/bedrock/src/jobs/events.test.ts packages/bedrock/src/cli/alerts.test.ts --timeout 30000
bun packages/bedrock/test/probe-benchmark.ts
```

Focused result: **29 pass / 0 fail**, 177 assertions, 9 files, 1.475 s
(`/dev/shm/bedrock-r2-m2-evidence.log`). The real-daemon scenario again verifies
four opening/four resolution rows with eight unique transition keys, no pages
for idle/single-probe/ordinary-job noise, child inhibition beneath a tunnel
outage with unrelated job/backup delivery eligible, and immutable retries across
daemon restart. At night critical pages submit immediately after grouping;
non-critical tests still wait until 07:30 Brussels.

Probe benchmark result (`/dev/shm/bedrock-r2-probe.json`):

```json
{"pebbles":24,"concurrency":2,"cycles":100,"probes":2400,"elapsed_ms":179.33852899999988,"parent_cpu_ms":91.256,"children_cpu_ms_at_100Hz":310,"parent_rss_before":45965312,"parent_rss_after":53043200,"worker_rss_delta":9281536,"evaluator_100_cycles_ms":326.30174599999987,"evaluator_100_cycles_cpu_ms":100.104,"rss_with_alerts":68583424}
```

About **5.01 ms CPU/sweep** including evaluation; warm IPC wall 1.79 ms/sweep,
evaluation wall 3.26 ms/sweep, Worker RSS delta 8.85 MiB. The earlier recorded M2
run above measured 8.94 ms CPU/sweep and 8.48 MiB Worker RSS. No observed timing
regression; these are noisy host measurements under different load, not a
controlled speed comparison. The benchmark asserts probes do not reset activity.
No full-filesystem, pinned-reader WAL, cold-HDD or Windows validation was run.

Required verification on the final runtime source:

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun install && bun run typecheck && bun test --timeout 30000
```

Install: checked 120 installs across 190 packages, no changes, exit 0.
Typecheck: exit 0. Full suite: **614 pass / 5 skip / 2 fail**, 6,313 assertions,
621 tests across 161 files, 261.85 s (`/dev/shm/bedrock-r2-full.log`). The test
command exits 1 solely for the two explicitly permitted pre-existing failures:

- `real daemon keeps an unconfigured application burst alive for a paused consumer`
- `real daemon closes application sockets only when their configured output bound is exceeded`

`standalone react installs, typechecks and deploys daemon-owned packages` passed
in 11.82 s at the requested timeout; no isolated rerun was needed. The large job
reconciliation regression passed in the full suite at **177.14 ms**. All nine R2
regressions passed. `git diff --check` passed; WORKLOG.md and
`src/runtime/web-static-build.ts` remain untouched. No push.
