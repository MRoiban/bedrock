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
- Comms owns provider channels. Normal Poke first, explicit ntfy+email after
  15 min unresolved, then reminders at least 6 h apart. All page/escalation
  submissions wait during 23:00–07:30 Brussels, matching the design's default
  home-outage policy; no automatic high-urgency night override. Weekly Monday
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
- Night outage remains pending at 23:10 Brussels and submits at 07:30.
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
