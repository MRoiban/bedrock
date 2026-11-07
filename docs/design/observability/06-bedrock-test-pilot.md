# M3 implementation evidence (2026-11-07)

Branch: `t3/add-bedrock-test-runner`, based on `e8336f9`. No deployed release,
data or secret was modified. No deployed secrets file was read. `WORKLOG.md` belongs to
the orchestrator and was left untouched.

## Environment and commands

Bun 1.4.3, Linux x64. `~/.cache/ms-playwright` already contained Chromium and
headless shell revision 1248. Playwright 1.64.0 pins that revision; the harness
launched Chromium 156.0.8078.4. Browser downloads: **0 bytes**. Dependencies are
exact-pinned optional peers plus development dependencies, never runtime imports.

For each pilot, copied the latest release to `/dev/shm/bedrock-m3-pilots/<name>`
using `shutil.copytree(..., symlinks=True)`, excluding `.bedrock`, `.git`,
`.env*`, `secrets.json`, and SQLite files. Replaced only the scratch copy's
`node_modules/bedrock` and `node_modules/@bedrock/ui` links with this checkout.
No install or test ran in a deployed directory. The harness provided a fresh
temporary `BEDROCK_HOME` and empty migrated application data for each run.

Command, from each scratch directory:

```sh
TMPDIR=/dev/shm bun /home/jarvis/.t3/worktrees/bedrock/t3-25cd95f5/packages/bedrock/src/cli/index.ts test --json
```

No retries, visual baselines or screenshot comparisons were selected. Failure
screenshots and traces were retained. These pilots cover the new testing surface
with three real pebbles; configurations were added only to scratch copies.

## Results

| Pilot / release | Duration | Readiness / browser errors | Accessibility | Overflow |
| --- | ---: | --- | --- | --- |
| babel / `1793447014680-622764fd` | 9.885 s | Passed at both widths | Failed: one serious `color-contrast` node (`.pebble-card-link`) at each width; ratio 4.37:1, required 4.5:1 | Desktop passed; phone failed: scroll width 424px at 390px (34px overflow) |
| typewriter / `1794057079333-e2d0bc1f` | 8.181 s | Passed at both widths with explicit ready selector | Failed: four serious `color-contrast` nodes at each width (subtitle, empty-state text, two action labels); desktop also one serious `label-content-name-mismatch` on account control | Passed at both widths |
| comms / `1792500971648-87565677` | 10.794 s | Passed at both widths | No definite violations; 14 `color-contrast` nodes per width are **incomplete**, requiring manual review | Passed at both widths |

Babel and Typewriter exited 1; comms exited 0. All three had no `tests/unit`
directory, reported as skipped. This is root/empty-state smoke coverage, not a
claim about their complete user journeys or production data. Comms' services
started against empty isolated data without provider credentials.

Scratch configuration for Babel:

```ts
export default { pages: [{ path: '/', user: 'owner', ready: 'main' }] };
```

Scratch configuration for Typewriter:

```ts
export default {
  pages: [{ path: '/', user: 'owner', ready: 'h3:has-text("No projects yet")' }],
};
```

## Harness findings and corrections

- First Babel run (18.662 s) incorrectly treated the protected anonymous root's
  expected login redirect as a failure. Defaults now report that state as skipped
  and smoke the authenticated root. An explicitly declared anonymous page must
  still reach its own app-ready selector; redirects never count as app readiness.
- First Typewriter run (40.870 s) could not establish readiness: it has no main
  landmark. No accessibility/overflow result was claimed for that run. An explicit
  empty-state selector in the scratch config enabled the checks above. Structural
  default selectors cannot infer application readiness for every UI.
- A synthetic integration probe found that Chromium resolves `*.localhost`, while
  Playwright's separate API request client does not on this host. Login verification
  now uses browser same-origin fetch. The author guide explains the API assertion
  pattern; no DNS or `/etc/hosts` changes were made.
- A targeted JUnit parser test caught a self-closing testcase swallowing the next
  failure. Parsing was corrected and the regression test passed.
- Separate stdout/stderr file opens could overwrite each other's logs. The runner
  now gives both child streams the same open file descriptor.

## Other validation

The targeted command `TMPDIR=/dev/shm bun test packages/bedrock/src/testing
packages/bedrock/test/pebble-test.test.ts` passed 10 tests, 38 assertions, in
30.94 s initially; the final focused rerun passed the same 10 tests / 38 outer
assertions in 20.63 s, including additional assertions inside the generated browser
spec that separate auth-role pages inherit the selected viewport. It covers closed-template seeding/copy isolation, real runtime unit tests,
real dev login/logout and separate roles, cron off/explicit jobs, smoke failures,
flaky diagnostic retries remaining nonzero, failure artifacts, discovery, retention,
and missing/approved/reused visual baselines with the preparation hook.

Packed Bedrock with `bun pm pack --destination /dev/shm/bedrock-m3-production
--quiet`, then installed that tarball in a new consumer with
`TMPDIR=/dev/shm BUN_INSTALL=/dev/shm/bedrock-m3-production/bun bun install
--production`: 10 packages installed in 1.203 s; no Playwright, axe, or browser
packages were installed. Its `bedrock test --json` ran a real SQLite runtime unit
test successfully without browser tooling; browser smoke was explicitly skipped
for the API-only pebble. `bedrock test --help --json` also succeeded.

Raw pilot JSON is in `/dev/shm/m3-pilot-babel-final.json`,
`/dev/shm/m3-pilot-typewriter-configured.json`, `/dev/shm/m3-pilot-comms.json`;
artifacts are referenced from each report under the scratch pebble's
`.bedrock/tests/<run>/`. These paths are temporary; the findings above are durable.

No architecture disagreement. No new runtime dependency. Apps must bundle their
own fonts and provide stable screenshot states; the harness does not replace their
fonts or certify accessibility. External services still require app-specific test
substitutes. Canonical visual acceptance remains the home server's Linux/pinned
Chromium environment.

## Required verification

Used a fresh temporary directory on `/dev/shm` for every verification invocation:

```sh
export TMPDIR=$(mktemp -d /dev/shm/bedrock-test-XXXX)
bun install
bun run typecheck
bun test
```

- Install passed: checked 120 installs across 190 packages, no changes, 0.026 s.
- Typecheck passed in 10.817 s; it also passed again after the final fixture fix.
- Unmodified `bun test`: 545 passed, 5 skipped, 4 failed, 1 late error, 4,200
  assertions, 554 tests / 141 files, 253.23 s (wall 253.321 s).
- Failures: the two owner-listed socket backpressure tests, React starter's 5 s
  timeout, and the 90 MB upload's 5 s timeout. The late error was the timed-out
  upload continuing into another storage test (`chunkAttempts` 3 versus 2).
- `bun test -t "React starter"`: 1 passed, 1 timed out, 552 filtered, 14.90 s.
- `bun test -t "SDK chooses chunking above 90 MB"`: 1 timed out, 553 filtered,
  17.95 s. Thus neither default timeout was silently ignored.
- `bun test packages/ui/scripts/react-template.test.ts --timeout 30000`:
  1 passed / 12 assertions / 1 file, 13.43 s.
- `bun test packages/bedrock/test/storage.test.ts -t "SDK chooses chunking above 90 MB" --timeout 30000`:
  1 passed / 5 assertions / 1 file, 6 filtered, 11.58 s.

Confirmation command, with only the two explicitly permitted cases excluded and
30 s for tests using Bun's default timeout (no source/test timeout changed):

```sh
bun test --timeout 30000 -t '^(?!real daemon keeps an unconfigured application burst alive for a paused consumer$|real daemon closes application sockets only when their configured output bound is exceeded$)'
```

Passed: **547 passed, 5 skipped, 0 failed**, 4,204 assertions, 552 tests / 141
files, 294.63 s (wall 294.694 s). The final auth-context viewport fix was then
verified by another focused 10-test run and typecheck. `git diff --check` passed;
`WORKLOG.md` is unchanged. Validation was Linux/Bun 1.4.3 only; Windows/macOS and
the minimum Bun 1.2 were not exercised. Pilot screenshots stayed opt-out; the
visual hook/baseline lifecycle was exercised by the synthetic fixture, not two
production pebble journeys.

Logs: `/dev/shm/m3-install.log`, `/dev/shm/m3-final-typecheck.log`,
`/dev/shm/m3-full-test.log`, `/dev/shm/m3-react-rerun.log`,
`/dev/shm/m3-upload-rerun.log`, `/dev/shm/m3-react-isolated.log`,
`/dev/shm/m3-upload-isolated.log`, `/dev/shm/m3-confirmation.log`,
`/dev/shm/m3-targeted-final.log`, `/dev/shm/m3-final-typecheck3.log`.
