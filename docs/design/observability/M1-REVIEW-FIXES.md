# M1 review fixes

Fixes R1-2, R1-3 and R1-5 from the review of `0e42da5`. No dependencies,
pebble-facing concepts or renamed APIs. WORKLOG.md is untouched.

## Changes

- R1-2: sparse positional RED payloads (only populated histogram buckets), compact
  resource/log payloads, no empty traffic-class rows, and fewer duplicated indexes.
  Existing M1 payloads remain readable and compact incrementally, 256 rows per
  opening/write. Accounting updates when an aggregate grows. Expiry uses bounded
  indexed lookups before budget admission rather than scanning retained history.
- Metrics keep their 160 MiB logical budget: status 4, raw resources 32, minutes
  96, hours 22, days 6 MiB. Each tier reclaims its own oldest rows. Physical
  pressure reclaims raw resources/logs/events/lifecycle, minute/hour/day history,
  then status last. Budget loss counts remain visible.
- R1-3: the supervisor omits groups without live cgroups, the sampler omits empty
  or unreadable groups, and the store rejects null-source resources. Status
  returns explicit nulls as soon as there is no measurable group, even if a
  recent resource sample remains in history.
- R1-5: follow subscribes before history, buffers at most 1 MiB of accepted live
  output, and queries history through a per-boot acceptance-sequence watermark.
  Identical timestamps/text do not cause deduplication errors. Abort, cancellation
  and overflow remove the listener; overflow closes the follower.

The physical cap remains **248 MiB**. With spills disabled and a successful
truncate before each write transaction, even a transaction dirtying every DB
page fits below 512 MiB with its WAL (about 497.5 MiB with 4 KiB pages and WAL
frame overhead). The remaining margin covers shared memory and bounded follow-up
maintenance. A larger DB plus a nominal 64 MiB WAL limit would rely on a soft
limit: the backstop cannot stop a transaction's commit from growing its WAL.
The compact ordinary replay below leaves room for growth of coarse tiers;
physical pressure is still allowed to shorten retention on larger workloads.
For the all-24-running heavy fixture, logical tier usage was 16,450,560 bytes raw,
1,022,400 status and 71,370,000 minutes, below 32/4/96 MiB respectively.
Projecting its eight-day hourly/daily payload sizes to 90/365 days gives
17,418,240 / 3,011,250 bytes, below the 22/6 MiB reservations. These projections
assume the same dimensions/histogram occupancy; they are capacity estimates,
not a 90/365-day soak.

## Reproduction and results

All commands use a temporary home and never access `$HOME/.bedrock`:

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun install
bun run typecheck
bun test --timeout 30000
bun test packages/bedrock/src/daemon/telemetry packages/bedrock/src/daemon/logs-follow.test.ts --timeout 30000
bun packages/bedrock/test/telemetry-retention.ts low
bun packages/bedrock/test/telemetry-retention.ts low-pressure
bun packages/bedrock/test/telemetry-retention.ts heavy
bun packages/bedrock/test/telemetry-bench.ts --growth-only
bun packages/bedrock/test/telemetry-bench.ts --load-only
```

The retention replay injects UTC timestamps for eight days and 24 pebbles. Low
traffic is one request/minute/pebble, 20 measurable pebbles sampled every 15 s,
four unmeasurable/idle pebbles, and one approximately 180-byte log per ten minutes
per pebble (six/hour). The additional low-pressure replay uses one log/minute.
Heavy traffic is 1 request/s/pebble, all 24 measurable, one log/minute and 1%
success diagnostics. As in original M1, the historical request inputs are minute
aggregates; the final five heavy minutes are replayed at one-second resolution
to test the actual 7,200-row status window. These are storage simulations, not
real-time soaks. Eight days can demonstrate eight days of coarse history, not
90/365 days of elapsed retention.

| Eight-day replay | Ordinary (6 logs/hour) | Low requests, 1 log/minute | Heavy (1 request/s, 1 log/minute) |
|---|---:|---:|---:|
| DB bytes | 158,351,360 | 251,617,280 | 251,604,992 |
| DB MiB | 151.016 | 239.961 | 239.949 |
| WAL bytes at final observation | 0 | 0 | 0 |
| Input drops | 0 | 0 | 0 |
| Physical budget evictions | 0 | 93,184 | 234,752 |
| Other budget evictions | 0 | 0 | 0 |
| Request minute history | 7 d / 241,920 rows | 7 d / 241,920 | 7 d / 241,920 |
| Request hour history | 8 d / 4,608 rows | 8 d / 4,608 | 8 d / 4,608 |
| Request day history | 8 d / 192 rows | 8 d / 192 | 8 d / 192 |
| Raw resource history | 24 h / 115,200 rows | 24 h / 115,200 | 24 h / 138,240 |
| Resource minute history | 7 d / 201,600 rows | 7 d / 201,600 | 7 d / 241,920 |
| Resource hour history | 8 d / 3,840 rows | 8 d / 3,840 | 8 d / 4,608 |
| Resource day history | 8 d / 160 rows | 8 d / 160 | 8 d / 192 |
| Logs | 7 d / 24,192 rows | 5.330556 d / 184,219 | 3.754861 d / 129,764 |
| Diagnostic events | 8 d / 2,765 rows | 5.329861 d / 1,842 | 3.754861 d / 77,864 |
| Status window | 5 min, all 24 pebbles | 5 min, all 24 | 5 min, all 24 |
| Status rows/completions per pebble | 5 / 5 | 5 / 5 | 300 / 300 |

Every replay passed `PRAGMA integrity_check`. No lifecycle records are generated
by this storage fixture; no lifecycle retention measurement is claimed. The
one-log/minute case explicitly shows the physical cap shortening logs/events
before their logical budgets fill. Ordinary six-logs/hour ingestion has zero
evictions and leaves about 89 MiB below the 240 MiB admission reserve boundary.

Final verification after all implementation/test edits:

- `bun install`: 120 installs across 190 packages checked, no changes, exit 0.
- `bun run typecheck`: exit 0.
- `bun test --timeout 30000`: **575 pass, 5 skip, 2 fail**, 5,901 assertions,
  582 tests / 148 files, 229.05 s, exit 1. Only the two approved pre-existing
  failures remain: `real daemon keeps an unconfigured application burst alive
  for a paused consumer` and `real daemon closes application sockets only when
  their configured output bound is exceeded`.
- Focused telemetry/follow command above: **21 pass, 0 fail**, 1,287 assertions,
  3 files, 18.28 s. New cases inject timestamps/clocks or gate history with a
  deferred promise; there are no long sleeps. Coverage includes a scaled
  eight-day retention replay, logical/physical status protection, empty classes,
  null resource omission and stale-status suppression, legacy compaction,
  stable history snapshots, late commits, same-text/same-time logs, storage
  failure and initialization-buffer overflow.
- `git diff --check`: exit 0. No tests were skipped/changed to hide the two
  approved failures. No WORKLOG.md edits.

The original M1 `--growth-only` fixture (one day, 24 × 1 request/s, resources
15 s, one log/minute) now uses **51,974,144 bytes (49.566 MiB)**, zero drops
and zero evictions, versus 147,759,104 bytes in the published M1 measurement.
The subsequent 10,240 oversized-log inputs intentionally hit admission:
193,191,936 DB bytes, 70,072 WAL bytes, 2,560 dropped records and 1,408 log
budget evictions. Integrity checks passed for both eight-day pressure replays.

Proxy benchmark: two `--load-only` invocations per revision, six trials/mode,
5,000 measured requests/trial at concurrency 16 after 5,000 warm-up requests.
CPU includes the daemon Worker and post-load drain, excluding the load generator.

| Median (six trials) | Original telemetry off | Original on | Fixed off | Fixed on |
|---|---:|---:|---:|---:|
| p50 ms | 2.093867 | 2.185476 | 1.940653 | 1.968077 |
| p99 ms | 5.838828 | 5.719323 | 6.123899 | 5.741059 |
| CPU ms / 5,000 requests | 1,280.176 | 1,294.449 | 1,195.944 | 1,235.550 |

Fixed observed on/off differences: +0.027424 ms p50, -0.382840 ms p99,
+39.606 ms CPU (3.31%, 7.92 microseconds/request). Against the repeated original
telemetry-on baseline, p50 and CPU decrease; p99 increases 0.021736 ms (0.38%).
No material proxy regression is observed, but host variance prevents a precise
causal overhead claim. Diagnostic event-rate drops during bursts and log-rate
drops during floods are expected limiter behavior; no queue/storage drops were
observed in these benchmark trials. Both versions' raw trials, including floods,
are in [M1-review-measurements.json](M1-review-measurements.json).

The original benchmark was run from an unmodified archive, using the installed
workspace dependencies (including package-local dependencies):

```sh
telemetry_baseline=$(mktemp -d /dev/shm/bedrock-baseline-XXXX)
git archive 0e42da5 | tar -x -C "$telemetry_baseline"
python3 -c 'from pathlib import Path; import sys; b=Path(sys.argv[1]); root=Path.cwd(); paths=[root/"node_modules",*root.glob("packages/*/node_modules")]; [(b/p.relative_to(root)).symlink_to(p,target_is_directory=True) for p in paths if p.exists()]' "$telemetry_baseline"
bun "$telemetry_baseline/packages/bedrock/test/telemetry-bench.ts" --load-only
```

The first archived-baseline attempt lacked package-local dependency symlinks and
failed to resolve `arctic`; it produced no measurement and was corrected above.
Both completed baseline invocations used the corrected setup.

## Compatibility and remaining limits

`TelemetryStore` construction, write, query and purge signatures stay compatible;
public HTTP metric/resource/log row fields and cursors are unchanged. Additions
are optional internal log record boot/sequence fields, `Query.watermark`,
`Telemetry.logWatermark()`, an optional sampling clock, and an optional
`telemetryStatus` measurable flag. M2/M4b consumers can keep their existing calls.
Persisted numeric field positions are append-only.

Budgets precede time retention. Longer lived hour/day rows consume increasing
space beyond an eight-day replay; no year-long soak is claimed. Legacy payloads
compact incrementally, so a large old store may experience admission pressure
until compaction catches up. Follow remains best effort across storage/queue
failure, and overflow disconnects rather than silently skipping buffered lines.

Two early replay attempts were abandoned while tuning charges/expiry. Another
was interrupted by the replay's deliberate pinned-reader rejection when an
external diagnostic connection briefly opened the DB; final replays do not
open a second connection. No incomplete replay is reported as a passing result.
