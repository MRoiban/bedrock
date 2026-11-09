# M4b error tracking evidence (2026-11-07)

Base `0e42da5`, branch `t3/error-tracking-capture`. No runtime dependencies added.
No live daemon, release, data or secrets were modified. Only the three specified
live release trees were read to copy code; tests use temporary homes in /dev/shm.
WORKLOG.md is unchanged; no subagents were started; nothing was pushed.

## Implementation

The daemon intercepts the native version-1 error protocol before `ensure()` and
checks Origin and cached release access without starting a child. Body admission,
streamed byte caps, schema validation, deadlines, browser/server quotas and queue
limits bound ingress. Browser createClient capture defaults to unhandled errors
and rejections; console and Bedrock HTTP 5xx are optional. An optional React
ErrorBoundary reports handled exceptions. Arbitrary rejection objects are not
serialized; application getters are avoided, including when accessing Chromium's
native lazy stacks. Capture failures never become new error reports.

Raw server errors are reported over IPC before wrapping at query/mutation,
transactional/detached route/job, socket and service boundaries. Expected
BedrockErrors below status 500 are excluded. Captured objects and their Bedrock
wrappers are deduplicated. Startup capture is best effort.

M4a's exact retained-release map lookup resolves browser frames off the serving
thread. v1 fingerprints use runtime, exception type and five nearest mapped app
frames. Messages/releases/columns are excluded. Unmapped issues remain visibly
unmapped and may collide by type; no original source is invented. Manual merges
retain aliases/counts; resolved issues reopen on recurrence. Extension and
ResizeObserver namespaces never produce digest transitions; bots are tagged.

M1's existing serialized Worker owns error writes/reads as well as telemetry.
Errors use a separate errors.sqlite to preserve M1's independent physical budget;
this is a documented implementation adjustment to the design's original single
observability file, not a second Worker or runtime dependency. A 1 GiB logical
payload ceiling plus conservative 480 MiB DB / bounded WAL ceiling precede
14-day payload visibility and 90-day counts. Samples cap at 20 per issue/release/
UTC day; aliases and dedup IDs are bounded. Expiry cleanup is incremental.
All error data, including issue state, is excluded from backups by choice.

CLI/API reads use scoped logs, state changes use scoped lifecycle; merge requires
confirmation. M2 can consume telemetry.errors.onIssue(callback), with durable
catch-up at GET /api/pebbles/:name/errors/transitions?after=<id> (100 rows/page,
90 days). Transitions explicitly say delivery=digest; no page is sent here.
Reference and author guide document the protocol, decisions and limits.

## Copy-only pilots

Copied, excluding node_modules, .bedrock*, .git, .env* and secrets*, from:

- babel/releases/1793447014680-622764fd
- typewriter/releases/1794057079333-e2d0bc1f
- comms/releases/1792500971648-87565677

The full prefix is $HOME/.bedrock/pebbles/. Only release directories were opened.
The final copies are under /dev/shm/m4b/isolated-ready/<name>/source. The original config is retained
as pebble-original.ts; a wrapper adds the throwing route. To avoid external side
effects and credentials, these copies use public access, empty jobs/services and
fresh migrated data. This is not a test of their production data or integrations.
The existing web entry/UI remains, with an injected error-pilot.ts script.

Babel ships a static prebuilt frontend without original maps. Its injected probe
was separately Bun-built with an external map, then M4a privatized that map during
deploy. Typewriter/comms' HTML entries were built by M4a normally. All copies
were archived and deployed through the real HTTP daemon API, not attached in dev
mode. Chromium navigated the production entry through the daemon; each planted
throw/rejection ran twice, and the server throwing route was fetched twice.

Each copy produced exactly these three planted groups, with count 2 each:

- URIError browser throw: error-pilot.ts:3:43 (Babel),
  web/error-pilot.ts:3:43 (Typewriter/comms).
- EvalError unhandled rejection: error-pilot.ts:4:61 (Babel),
  web/error-pilot.ts:4:61 (Typewriter/comms).
- SyntaxError server throw: pebble.ts:3:42, function pilotServerFailure.

All nine planted issues have missing_maps=0 and mapped original frames. Each
private manifest and each manifest-listed bundle's .map URL returned 404.
The final Babel run also produced four issues on its empty data: plain
Error “Sign in to Babel” at two distinct server sites, a server TypeError
accessing value.host, and its browser CoreError symptom in the old static
bundle. The initial run verified that symptom is marked missing_maps=1; the
intermediate run saw only the three server issues. Typewriter/comms had no
other captured issues.
This does not claim upstream source recovery for Babel's precompiled code.

The final pilot harness is /dev/shm/m4b/isolated-ready/pilot.ts; per-copy result.json, pilot.log and
results.json retain generated release IDs, frames, counts and map responses.
Exact invocation:

```sh
python3 /dev/shm/m4b/copy-isolated-ready.py
HOME=/dev/shm/m4b/isolated-ready/safe-home \
BUN_INSTALL=/dev/shm/m4b/isolated-ready/bun BUN_INSTALL_CACHE_DIR=/data/cache/bun \
PLAYWRIGHT_BROWSERS_PATH=/home/jarvis/.cache/ms-playwright \
TMPDIR=/dev/shm BEDROCK_HOME=/dev/shm/m4b/isolated-ready/safe-home \
bun /dev/shm/m4b/isolated-ready/pilot.ts > /dev/shm/m4b/isolated-ready/pilot.log 2>&1
```

The final pilot isolates HOME and BUN_INSTALL as well as BEDROCK_HOME; only
package/browser binary caches are shared, not browser profiles or credentials.
An initial isolated-HOME attempt could not find Chromium; pointing Playwright
at its existing binary cache fixed it without downloading/changing browsers.
Superseded pilot copies were moved to a private disk cache to free RAM; the
location is /dev/shm/m4b/superseded-location.txt. Final copies, logs/results,
baseline bundle source and the initial Babel error DB remain in /dev/shm/m4b.

## Verification

The real-daemon integration test additionally proves error posts accepted while
idle leave status=idle and pid=null; wrong Origin is rejected; malformed and
oversized bodies fail; exhaustion returns 429 with positive Retry-After; scoped
logs can inspect but cannot change state; status/other-pebble tokens cannot read;
CLI JSON inspection works; maps are not served. Repeated browser events count
once per occurrence. Query/mutation/route errors at one app site group together,
with original pebble.ts frames. A second deployed fixture verifies real IPC from
job, detached route, socket open and service stop throws.

Unit checks cover two retained release maps producing one fingerprint despite
changed message/release; regressions; idempotent merge aliases; ignore; extension
quarantine; ResizeObserver counts without samples/transitions; bot tagging;
client 20/min and five-event batches; beacon, backoff and listener cleanup;
privacy allowlists and application getter avoidance. Quota tests accept 90 browser
+ 30 server reports, rejecting the next of each; 16 body admissions cap pending
reads. Storage checks exercise eviction with a 12,000-byte budget, admission of
only 20 samples with the default budget, payload/count expiry at 15/91 days,
the default 1 GiB setting and the actual SQLite 480 MiB page ceiling. They do not
allocate/fill a real 1 GiB file or benchmark disk-full hardware behavior.

Required commands (logs under /dev/shm/m4b):

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun install && bun run typecheck && bun test --timeout 30000
```

The initial full run passed install/typecheck; tests: 571 pass, 5 skip, 2 fail,
4,868 assertions, 578 tests / 149 files, 270.04 s. Only the two owner-listed
socket failures occurred. A development run overlapped subsequent source edits
and saw mixed cached modules/new tests; it is not final-tree verification.
The later required full run passed install/typecheck (120 installs checked,
190 packages, no changes); tests: **573 pass, 5 skip, 2 fail**, 4,890 assertions,
580 tests / 150 files, 238.93 s. Again only the two owner-listed socket cases
failed. Logs: install-final-tree.log, typecheck-final-tree.log, full-final-tree.log.

Stable-tree confirmation (excluding exactly the two approved socket cases):

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun install && bun run typecheck
bun test --timeout 30000 -t '^(?!real daemon keeps an unconfigured application burst alive for a paused consumer$|real daemon closes application sockets only when their configured output bound is exceeded$)'
```

The first confirmation passed: 573 pass, 5 skip, 0 fail, 4,885 assertions,
578 tests / 150 files, 236.77 s. Afterwards, targeted privacy probes exposed
unredacted IPv6 loopback/Unicode emails and the need to load current secrets for
idle reports after daemon restart. Those are fixed, with tests for four-character
secrets, rotation and unreadable-secret fail-closed behavior. A final confirmation
uses the same command (confirmation-final.log): **574 pass, 5 skip, 0 fail**,
**4,891 assertions, 579 tests / 150 files, 240.21 s**. Install checked 120 installs
across 190 packages (no changes); typecheck passed (install-final.log and
typecheck-final.log). This final run covers the current secret-loading,
text-only read-redaction and IPv6/Unicode scrubbers. git diff --check passed.

The final focused command is:

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun test packages/bedrock/test/error-tracking.test.ts packages/bedrock/src/daemon/errors packages/bedrock/src/client/errors.test.ts --timeout 30000
```

Eight tests passed, zero failed, 226 assertions, three files, 6.15 s before the
final typed text-only read-redaction refinement; the final full confirmation
covers that refinement as well. Generic scrubbers never serialize application
getters; current secrets are read only in the Worker, without waking the pebble.

Client size command:

```sh
bun /dev/shm/m4b/size.ts
```

It Bun-builds identical minimal createClient entrypoints, browser target,
minified, baseline source exported with git archive 0e42da5 before committing,
then uses Bun.gzipSync. Results are size-final.json. The measured client bundle is 31,608 bytes minified / 12,277 bytes gzip, versus
26,422 / 10,240 at baseline: **+5,186 bytes minified, +2,037 bytes gzip**. This is bundle output, not a network/latency benchmark.

## Limits

No live deployment or production data/secrets were used. No Windows/macOS,
minimum Bun 1.2, large-disk fill or HDD latency test was performed. Existing
prebuilt browser clients need rebuilding to acquire default capture; missing
maps cannot recover absent upstream source. HTTP reporting is best effort,
including fatal IPC and hide-time delivery. Free-form messages can contain
application-specific private values beyond generic scrubbing; beforeSend can
filter them. There is no built-in web-vitals collector; vitals remain an explicit
pebble integration and never enter error payloads. M2 routing/delivery itself
was not exercised because that milestone is concurrent; durable digest inputs
are exposed and tested. No disagreement with ARCHITECTURE.md. The error-client
concept has the owner's explicit approval and three copy-only pilot consumers;
this does not claim permanent adoption by live pebbles.
