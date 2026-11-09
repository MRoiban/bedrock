# M4a production-build evidence (2026-11-07)

Based on `dd7c841`, branch `t3/private-release-sourcemaps`. No live release,
pebble data or secrets were modified; only the Babel release code was read and
copied. `WORKLOG.md` is unchanged. No runtime dependency or author configuration
was added; no architecture disagreement. This implements owner decision 6, not
browser error capture or the telemetry store.

## Context established

References in this section are at baseline `dd7c841`; paths below are relative
to `packages/bedrock/` unless stated otherwise.

- `src/runtime/web.ts:32` loads `web`; an HTML entry is dynamically imported as
  `Bun.HTMLBundle` at line 38. `src/runtime/index.ts:77` installs it at `/*` and
  line 97 starts `Bun.serve`; line 99 explicitly enables HMR only for dev. Hosted
  HTML was compiled lazily by Bun on first request, with Bun's asset handling.
- `src/runtime/bundler.ts:12` resolves React/React DOM browser subpaths from
  `process.cwd()` so linked Bedrock/UI imports share the pebble's React.
  `src/runtime/bunfig.toml:2` configures `[serve.static]` plugins.
  `src/runtime/bundler.ts:22` selects this config unless the pebble supplies its
  own bunfig; that list replaces Bedrock's defaults. The new build loads the same
  list. Existing custom-plugin and single-React tests both pass.
- Static directories already used weak size/mtime ETags/304s
  (`src/runtime/web.ts:19`), immutable caching for fingerprinted assets and
  `no-cache` otherwise (line 21), plus previous-release asset lookup (line 44).
  These headers now also apply to prebuilt HTML output; generated hashes do not
  require a digit. HTML always revalidates.
- `src/daemon/proxy.ts:41` stamps `x-bedrock-release` and line 43 appends the
  `bedrock-release` Server-Timing description. `src/daemon/supervisor.ts:209`
  chooses the directory basename (plus child start time in a dev daemon), passed
  at line 226. `src/client/release.ts:9` takes the initial page release from
  navigation Server-Timing; `src/client/index.ts:50` observes HTTP release headers.
  This protocol and proxy/log implementations were not changed.
- `src/cli/daemon.ts:112` creates a temporary archive location, line 115 calls
  `createArchive`, line 118 uploads it. `src/daemon/archive.ts:108` implements
  archive exclusions; line 17 validates/extracts uploads, line 72 installs a
  release, line 85 runs `bun install --production`, and lines 93/100 link daemon
  packages/fallback peers. Existing dependency/lockfile rewriting is unchanged.
- `src/daemon/releases.ts:65` creates the release below
  `<home>/pebbles/<name>/releases/<timestamp-id>`; lines 78/80/81 extract, install
  and launch. `src/daemon/supervisor.ts:219` builds the Bun child command,
  line 223 launches it and line 271 health-checks it before activation.
  `src/daemon/releases.ts:141` keeps three releases, including selected/previous.
- Bun already maps server TS to source lines. The real deployed test pebble's
  `/stack` handler throws/catches `Error('server probe')` and returns its stack;
  the test verifies `pebble.ts:3:`. No server build was introduced.
- `src/cli/dev-launcher.ts:19` launches the dev worker; `src/cli/dev.ts:11`
  attaches the source pebble. The M3 browser harness uses this same launcher
  (`src/testing/index.ts:47`). These files were not changed.

## Implementation and checks

Builds run on the daemon host after installation, using that host's Bun and
installed release dependencies. This avoids requiring the laptop or shipping
laptop-built HTML artifacts. The existing installer discards lockfiles and allows
version ranges: this change does **not** claim hermetic dependency resolution.
One separate compiler process runs at a time; each has a 120-second deadline.
Configuration imports get the child's allow-listed environment/secrets and
reserved release/data/home values; failures redact secrets. After awaited build
writes, the worker exits explicitly so module-scope timers cannot turn a
successful build into a delayed failure.

New HTML releases use `Bun.build` with production React, minification, splitting,
absolute asset URLs, hashed JS/CSS/assets and external maps. `.bedrock-web/public`
is the sole production web root. Maps and their manifest are outside it, with an
owner-only map directory on POSIX. Uploaded artifacts are discarded before the
server builds. Static directories are already compiled: their URLs/content are
preserved, supplied external/inline maps are privatized, and map comments removed.
Files shipped without maps cannot be resolved back to absent original sources.

`daemon/source-maps.ts` supplies a dependency-free VLQ decoder and exact private
manifest lookup: release id + bundle pathname + one-based line/column yields
source/line/column/mapped name (nullable). Missing maps/releases/unmapped positions
return null. No event-provided URL is fetched. This is internal, not a new
pebble-facing concept; it adds no configuration to the concept budget.

New integration coverage exercises an actual Chromium throw -> original TS line,
CSS/image/lazy chunks, nested-page asset URLs, no map comments, 404s for map files,
encoded private directories and map-comment targets, ETags, cache headers, explicit
route precedence, server TS stacks, failed builds retaining the serving release,
restart without recompilation, rollback and pruning with matching maps. A static
fixture also verifies custom map filenames and inline maps. Existing dev HMR,
custom Bun plugins, single React, Bedrock React/UI integration tests still run.

## Pilot measurements

Host: Linux x64, Bun 1.4.3, Chromium 156.0.8078.4, Playwright 1.64.0. Source:
`$HOME/.bedrock/pebbles/babel/releases/1793447014680-622764fd/`, copied read-only to
`/dev/shm/m4a/before/source`; node_modules, `.env*` and secrets were excluded.
After uses a second copy. All daemon homes, databases and test outputs were under
`/dev/shm/m4a`; the live data/secrets directories were never opened.

Babel uses `web: "web"` and ships prebuilt static assets. This is an honest static
pilot, **not** evidence of runtime HTML compilation savings. The baseline code was
exported with `git archive dd7c841 | tar -x -C /dev/shm/m4a/base`; dependency links
point to this checkout's installed packages. The scratch harness starts an
isolated localhost daemon, creates/uploads the archive, awaits deployment and
reads child PID/port from the authenticated API. It times the first direct-child
HTML fetch (health had not requested HTML), then fetches the four HTML-linked
JS/CSS assets and reads `/proc/<pid>/status` RSS. No OS page-cache flush was done;
these are one warm-filesystem sample per version, under shared host load.

| Measurement | Before | After |
| --- | ---: | ---: |
| Deploy request through successful health/swap | 1,819.307 ms | 2,280.750 ms |
| First HTML request/body, cold child web path | 1.460 ms | 1.318 ms |
| Child RSS immediately after health | 86,700 KiB | 89,452 KiB |
| Child RSS after HTML + linked assets | 87,492 KiB | 90,252 KiB |
| Four linked JS/CSS assets | 703,351 B | 703,351 B |
| Entire static web tree, 57 files | 1,409,108 B | 1,409,108 B |
| All non-HTML assets, 55 files | 1,407,947 B | 1,407,947 B |
| Whole scratch command CPU (user + system) | 5.360 + 0.542 s | 5.498 + 0.670 s |
| Whole scratch command max child RSS | 94,124 KiB | 95,088 KiB |

The separate build worker alone measured **0.254 s wall, 0.256 s user + 0.059 s
system CPU, 90,748 KiB max RSS (88.6 MiB)**. This is process peak RSS, not aggregate
machine/cgroup memory; it includes importing Babel's approximately 10 MB server
entry to discover `web`. Average CPU was about 1.24 cores. There is no hard CPU or
RSS cap; serialization bounds overlapping compilers, not a single huge input.
The pilot adds about 461 ms to deployment; the tiny latency difference and modest
RSS difference are not a statistically supported performance improvement.

All 57 served files compare byte-for-byte equal against the source. Actual
production screenshots of the protected empty-state page match at 1280x720 and
390x844, with only the visible ephemeral port normalized to `PORT` in both DOMs:

- Desktop SHA-256: `3665d9a3e935374adca5aefb1e0da1009ca58b0e4feb2516c6b4fcef28a1ddb4`.
- Phone SHA-256: `c5e8e2ae2dcce47954cdb411e3530ac8fa74bd72540a4bbfc47d59028e6321b6`.

Both browser sessions had zero page errors. Separately, `bedrock test --json`
completed on each source copy: before 5.247 s, after 4.807 s. At both widths the
ready/browser-errors checks pass; accessibility fails on the existing contrast
violation, and phone overflow remains 424 px at a 390 px viewport (34 px). Both
commands exit 1, with unit tests skipped because Babel has no unit directory.
The production screenshot check and harness dev-path smoke are separate checks.
Babel supplies no maps; original-source symbolication was therefore proven with
the real HTML/TS fixture, not claimed for this map-less static pilot.

Exact scratch invocations (scripts/logs remain in `/dev/shm/m4a`, temporary):

```sh
TMPDIR=/dev/shm BEDROCK_HOME=/dev/shm/m4a/safe-home python /dev/shm/m4a/measure.py bun /dev/shm/m4a/bench.ts before
TMPDIR=/dev/shm BEDROCK_HOME=/dev/shm/m4a/safe-home python /dev/shm/m4a/measure.py bun /dev/shm/m4a/bench.ts after
TMPDIR=/dev/shm BEDROCK_HOME=/dev/shm/m4a/safe-home bun /dev/shm/m4a/render.ts before
TMPDIR=/dev/shm BEDROCK_HOME=/dev/shm/m4a/safe-home bun /dev/shm/m4a/render.ts after
cd /dev/shm/m4a/after/source
TMPDIR=/dev/shm BEDROCK_HOME=/dev/shm/m4a/safe-home python /dev/shm/m4a/measure.py bun /home/jarvis/.t3/worktrees/bedrock/t3-fce81b71/packages/bedrock/src/runtime/web-build-worker.ts
# Run separately in before/source (baseline CLI) and after/source (current CLI):
TMPDIR=/dev/shm BEDROCK_HOME=/dev/shm/m4a/test-before bun /dev/shm/m4a/base/packages/bedrock/src/cli/index.ts test --json
TMPDIR=/dev/shm BEDROCK_HOME=/dev/shm/m4a/test-after bun /home/jarvis/.t3/worktrees/bedrock/t3-fce81b71/packages/bedrock/src/cli/index.ts test --json
```

Raw data: `before.log`, `after.log`, `before-time.log`, `after-time.log`,
`build-pilot-time.log`, `render-{before,after}-normalized.log`,
`smoke-{before,after}.json`. Screenshots: `{before,after}/render-{1280,390}.png`.
An initial benchmark mistakenly fetched the auth envelope (zero assets), then
was corrected to use the API-reported child port; that sample is not reported.
`/usr/bin/time` was unavailable, so `measure.py` uses Python `resource.getrusage`
for child CPU/max RSS and `time.monotonic` for wall time.

## Verification

Ran the required sequence with a fresh RAM-backed temporary directory:

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun install && bun run typecheck && bun test
```

- Install: checked 120 installs across 190 packages, no changes, 6 ms.
- Typecheck: passed. Also passed after the final code changes.
- Unmodified full suite: 549 passed, 5 skipped, 4 failed, 1 late error;
  4,273 assertions; 558 tests / 144 files; 240.41 s.
- Failures: both owner-listed socket cases; the default 5-second 90 MB upload
  timeout (with its late `chunkAttempts` assertion); and `repeated fast failures…`.
  The last was a real new worker-lifecycle bug: configuration's module-scope
  150 ms exit timer survived successful build completion. Explicit worker exit
  fixes it. Nothing outside that worker was changed for this failure.
- `bun test packages/bedrock/test/daemon.test.ts -t 'repeated fast failures' --timeout 30000`:
  1 passed, 6 filtered, 3 assertions, 9.51 s.
- `bun test packages/bedrock/test/storage.test.ts -t 'SDK chooses chunking above 90 MB' --timeout 30000`:
  1 passed, 6 filtered, 5 assertions, 9.33 s.
- React starter passed in the full suite; no timeout exception was needed for it.

Full confirmation, excluding **only** the two owner-approved socket failures:

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun test --timeout 30000 -t '^(?!real daemon keeps an unconfigured application burst alive for a paused consumer$|real daemon closes application sockets only when their configured output bound is exceeded$)'
```

**551 passed, 5 skipped, 0 failed; 4,277 assertions; 556 tests / 144 files;
239.13 s.** The latest focused verification (also after the final reserved-build
environment fields and nested-URL/CSS assertions) ran:

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun install && bun run typecheck
bun test packages/bedrock/test/production-web.test.ts packages/bedrock/test/production-static.test.ts packages/bedrock/test/html-mode.test.ts packages/bedrock/test/single-react.test.ts packages/bedrock/src/daemon/source-maps.test.ts
```

Install/typecheck passed; **8 passed, 0 failed, 108 assertions, 5 files, 6.21 s**.
`git diff --check` passed. Logs are `/dev/shm/m4a/{install-final,typecheck-final,
full-test,fast-failures-rerun,upload-rerun,confirmation,install-complete,
typecheck-complete,target-complete}.log`.

## Limits

No Windows/macOS or minimum Bun 1.2 run was performed; the five platform skips are
Windows-only. No live deployment was performed. Old releases without a build
manifest retain the legacy serving path until redeployment. No claim is made
that a static bundle without original maps can be resolved to absent source, or
that one warm-filesystem sample predicts HDD/cold-cache behavior. The pilot ran
in RAM as requested, not against live HDD data. Build discovery imports
configuration, so module-scope application side effects remain an author risk.
The compiler has no hard memory/CPU limit; larger inputs need measurement before
making a capacity claim. Existing non-hermetic install resolution is unchanged.
