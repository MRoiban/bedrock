# M1 implementation and host measurements

Implemented daemon telemetry, separate from identity and pebble databases. One
Worker owns SQLite, FTS, rollups, checkpoints and cgroup reads. The proxy keeps
unsampled counters and histograms in bounded in-memory deltas; ingestion never
awaits storage. Supervisor lifecycle and stdout/stderr feed the same store.
Review follow-up: [retention, resources and follow fixes](M1-REVIEW-FIXES.md)
contains current limits and repeat measurements; the numbers below are the
original M1 baseline.

Creator API and CLI expose status, metrics, logs/search, resources and events
with scoped authorization, coverage, opaque pagination and drops. No runtime
dependencies were added. WORKLOG.md and the dev launcher were not edited.

Reference behavior is in [Daemon telemetry](../../reference.md#daemon-telemetry)
and the shipped author guide. Existing rotated logs remain read-only history
for plain tail/follow; SQLite is authoritative for new logs and FTS/JSON.

## Measurements

Host: Linux 6.12.113+deb13-amd64, x86_64, Bun 1.4.3. Temporary daemon homes and
fixtures on `/dev/nvme0n1p6` (ext4), cleaned afterwards. Separate daemon and load
processes. Each mode ran three trials of 5,000 requests at concurrency 16, after
5,000 warm-up requests and a 1.1 s drain. CPU is `process.cpuUsage` for the daemon
including its Worker, excluding the load generator and child. The measured CPU
window includes a further 1.1 s drain to account for asynchronous writes.

| Median across three trials | Telemetry off | Telemetry on |
|---|---:|---:|
| End-to-end p50 | 2.005 ms | 2.142 ms |
| End-to-end p99 | 5.462 ms | 5.887 ms |
| Daemon CPU per 5,000 requests | 1,240.103 ms | 1,289.314 ms |

Observed differences: +0.136 ms p50, +0.425 ms p99, +49.211 ms CPU (3.97%,
9.84 microseconds/request). The pure request-metric collector also measured
1.632 microseconds/request over 100,000 iterations after 10,000 warm-up iterations.
This is a contended laptop, not a controlled performance lab: raw trials overlap.
Earlier runs with shorter warm-up and concurrent test activity varied much more;
those raw results are included rather than discarded. No claim of exact causal
latency overhead follows from these samples.

A 5 ms timer measured maximum event-loop delay above its expected interval:
4.463 ms during the steady burst (off: 3.751 ms), and 1.355 ms during a three-second
log flood. The child printed 1,669,000 lines; 1,668,800 were rate-dropped and 200
accepted across four calendar-second limiter windows. Flood CPU was 2,703.549 ms
including the drain. An earlier heavily contended burst reached 38.772 ms, and
an earlier flood 9.708 ms. The 5 ms probe does not claim sub-interval visibility.

One simulated day: 24 pebbles, each 1 request/s, one approximately 180-byte
log/minute, resource samples every 15 s, and 1% diagnostic successes. Request
traffic is represented by minute aggregates (the transient one-second tier is
therefore approximated); this is a storage simulation, not a real 24-hour soak.
Result: **147,759,104 bytes / 140.914 MiB**, no drops. An additional 10,240
approximately 16 KiB log lines hit physical admission: **237,248,512 bytes /
226.258 MiB**, WAL zero at the final observation, 7,680 input records dropped,
3,840 oldest records evicted. Logical category accounting stayed below its
budgets. The actual default budgets were used, not scaled quotas.

Reproduce (use a temporary TMPDIR, never the real Bedrock home):

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun packages/bedrock/test/telemetry-bench.ts --load-only
bun packages/bedrock/test/telemetry-bench.ts --growth-only
```

[Raw measurements and methodology](M1-measurements.json) include every trial,
preliminary captures, category accounting and page limits.

## Faults and verification

Real-daemon tests served 100 successful responses during injected SQLITE_FULL,
100 across Worker failure, and 100 with an actually unreadable/unwritable
observability file. Each case counted drops and recovered after repair or Worker
restart. The SQLite unit test additionally hit a real SQLITE_FULL by limiting
pages, verified rollback/integrity, restored the limit and successfully wrote.
No host filesystem was deliberately filled. File-permission testing is POSIX;
Windows has explicit null resources but was not exercised on this host.

The automatic retry regression uses a 150 ms internal retry delay and continuous
ingestion, proving that failed attempts do not keep moving the retry deadline.
Real-daemon repair tests reset the retry clock through the internal test hook;
they do not wait out the production one-minute delay. Worker restart was tested
with the normal one-second delay. No fault hook is exposed in config, environment
or daemon HTTP APIs.

Final focused checks: 27 pass / 0 fail (642 assertions); the bounded-route
regression then passed with the store tests (7 pass / 0 fail, 36 assertions).
Checks cover store integrity, all rollup resolutions, FTS deletion/cursors,
privacy, log rate/byte/UTF-8 limits, resources, authorization, actual CLI envelopes,
body-failure/abort separation, recovery, all four classes beyond 1,000 status
rows, and late completions after deletion.

## Original limits and decisions

- Physical admission is deliberately more conservative than report 01's proposed
  448 MiB DB + 64 MiB WAL split: the DB caps at 248 MiB, dirty spills are disabled,
  and a pre-transaction truncate is required. Even rewriting all pages in one
  WAL transaction stays within the 512 MiB total. Logical category budgets remain
  256/64/160/32 MiB. The conservative physical limit may shorten retention early.
- Byte pressure reclaims the finest metric tiers first. Time expiry and purge are
  incremental. Coverage is observed record bounds plus bounded writer intervals,
  not a promise of continuous observation. Unsaved boot drop counters can be lost
  on a daemon crash. Telemetry purge is best effort if storage is unavailable.
- Follow is bounded and best effort; accepted live lines can precede a failed
  storage batch. Legacy files are not FTS-indexed. Application log privacy still
  depends on authors avoiding private data and deliberately encoded secrets.
- The benchmark fixture does not exercise HDD data I/O. Resource logic is tested
  with synthetic cgroup counters; the dev benchmark deliberately has no delegated
  child cgroups. No actual OOM kill was induced.
- No alerting, readiness, jobs/incident store, error ingestion, browser reporting
  or monitoring pebble is included. No pilot pebble was changed, so two real
  consumers of the new operational API are not demonstrated here. There is no
  disagreement with ARCHITECTURE.md; pilot consumption remains integration work.

## Exact verification commands and results

All test commands used `export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)`.

```sh
bun install
bun run typecheck
bun test
```

Install: 115 installs across 185 packages checked, no dependency changes.
Typecheck: exit 0. Final default-timeout full suite: 550 pass, 5 skip, 4 fail,
1 late error, 4,542 assertions, 559 tests / 141 files, 215.94 s. Failures were
both pre-existing socket failures plus React starter and 90 MB SDK timeouts;
the late assertion came from the already-timed-out upload test.

```sh
bun test --timeout 30000
```

Fresh full run on final source: **552 pass, 5 skip, 2 fail**, 4,552 assertions,
559 tests / 141 files, 233.29 s. Only these two owner-documented failures remain:

- `real daemon keeps an unconfigured application burst alive for a paused consumer`
- `real daemon closes application sockets only when their configured output bound is exceeded`

```sh
bun test packages/ui/scripts/react-template.test.ts --timeout 30000
bun test packages/bedrock/test/storage.test.ts -t 'SDK chooses chunking above 90 MB' --timeout 30000
```

Isolated React: 1 pass / 0 fail, 12 assertions, 4.29 s. Isolated 90 MB SDK:
1 pass / 0 fail, 5 assertions, 8.85 s (the test still exceeded its default five
seconds on an earlier isolated attempt). Neither timeout is silently ignored.

```sh
bun test packages/bedrock/src/daemon/telemetry packages/bedrock/test/telemetry.test.ts packages/bedrock/test/platform-admin.test.ts packages/bedrock/test/data-dir.test.ts packages/bedrock/test/daemon-cli.test.ts packages/bedrock/test/proxy.test.ts packages/bedrock/test/pebble-tokens.test.ts
bun test packages/bedrock/src/daemon/telemetry/store.test.ts
```

Focused: 27 pass / 0 fail, 642 assertions, 8 files, 14.13 s. Last store check:
7 pass / 0 fail, 36 assertions, 209 ms. `git diff --cached --check` passed.
The default-timeout suite is not fully green on this host; the 30-second run
has no failures beyond the two approved exceptions. No tests were skipped or
modified to hide either failure.
