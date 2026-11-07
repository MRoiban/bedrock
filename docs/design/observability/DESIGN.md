# Bedrock: observability, alerting and `bedrock test` (design draft)

Synthesised from four GPT-6.1-sol research reports (01–04 in this folder; every claim there is linked to code, docs or papers). Grounded in Bedrock at `fe93675`. All numbers are proposed defaults, not measurements.

## Principles (shared by all four reports)
1. **Inside the daemon, no new stack.** One daemon-owned `observability.sqlite` (separate from identity and pebble DBs). No Prometheus, Loki, Sentry server, sidecars or SaaS by default. Precedent: Coolify's Sentinel (SQLite rollups), Bugsink (SQLite Sentry alternative), Healthchecks.io.
2. **Telemetry never breaks serving.** Writes are batched off the request path (Worker, 1 s / 256 records); storage failure or a full budget drops data with counters, never blocks HTTP. Learned from SQLite WAL starvation and OpenObserve/Netdata budget overshoot.
3. **Bounded everything.** Byte budgets before time retention; no unbounded labels (no raw URL, user, request ID as dimensions — Caddy/Loki cardinality failures).
4. **Privacy by allowlist.** No bodies, cookies, auth, query strings, IPs, emails, user agents; route templates only; scrub secrets twice.
5. **Few alerts, all actionable.** Records and digests by default; pages only for things the owner must act on (PagerDuty alert-fatigue evidence, Etsy removing resource alerts).
6. **Agent-first.** Every view is a `--json` command with Bedrock's envelope, cursors, coverage and drop counts.

## 1. Metrics, events, logs (daemon)
- **RED + saturation, unsampled:** per pebble and traffic class (ordinary / stream / WebSocket / control): starts, completions, failures (5xx + transport/body failure; client aborts and 4xx separate), in-flight, open sockets. Latency as OTel-bucket histograms, split headers-ready vs stream lifetime and success vs failure; p95 shown as a bucket range, not a fake exact number. DDSketch only if real investigations need it.
- **Resources:** every 15 s from existing cgroups (CPU, memory, swap, OOM events), never waking idle pebbles; Linux-first, explicit nulls elsewhere.
- **Lifecycle events:** spawn, ready, exit/crash (code, signal), retry, idle, stop, deploy retirement.
- **Logs:** stdout/stderr into SQLite with FTS5 search, 16 KiB/line cap, per-pebble rate limits (50 lines/s) with drop counters; replaces the rotated files.
- **Diagnostic request events:** all failures and >1 s requests, plus 1 % of successes.
- **Retention:** 1 m/7 d, 1 h/90 d, 1 d/365 d rollups; events 90 d; logs 7 d; total budget **512 MiB** (logs 256, events 64, metrics 160, lifecycle 32).
- **CLI:** `bedrock status` (now + last 5 min RED), `bedrock metrics <p> --since 1h --step 1m`, `bedrock logs <p> --search … --since …`, all `--json`.

## 2. Errors (browser + server)
- **Own tiny protocol, not Sentry's (yet):** `POST /_bedrock/errors` on each pebble origin, intercepted by the daemon without waking the pebble. Sentry-envelope compatibility is feasible later as an error-only adapter, but its framing, quotas and artefact APIs are real extra contracts (Bugsink's ingest shows the cost).
- **Capture:** `error` + `unhandledrejection` listeners in `bedrock/client` by default. Handled React errors (optional `bedrock/react` boundary), Bedrock HTTP 5xx instrumentation and console capture are explicit opt-ins; no automatic web-vitals instrumentation. Server: unexpected throws at query/mutation/route/job/socket/service boundaries via IPC, before they become responses; expected validation/auth errors excluded.
- **Transport and backpressure:** batch ≤5 events/2 s, `sendBeacon` on hide; client 20/min; daemon 120/min/pebble with reserved capacity for server crashes; 429 + Retry-After.
- **Grouping:** fingerprint = runtime + exception type + up to 5 nearest *mapped* app frames (path, function, normalised line); versioned, with aliases for manual merge. Never group by release or raw message (Rollbar/Sentry/Bugsink lessons; Microsoft WER bucketing).
- **Source maps:** M4a supplies private per-release deploy-time maps; missing maps stay visible.
- **Noise:** extension-only stacks quarantined, ResizeObserver loops counted not alerted, bots tagged.
- **Storage:** 1 GiB global error budget, separate `errors.sqlite` owned by the M1 Worker; 14 d payloads, 90 d counts, 20 samples/issue/release/day. All error data, including issue state, is excluded from backups. Regressions reopen resolved issues. See reference for conservative physical limits.
- **No web-vitals by default.**
- **CLI:** `bedrock errors <p>`, `errors show|resolve|ignore|merge`.

## 3. Uptime, jobs, alerting, status
- **Health split:** keep `/_bedrock/health` (liveness); add readiness over IPC (migrations done, DB readable, required services up) → `starting|ready|degraded|failed|idle|stopped`.
- **Local probes** every 30 s, open after 3 failures, recover after 2 (Gatus). Idle pebbles are "available on demand", not probed awake.
- **Who watches the box:** a daemon on a dead host can't report itself. Free options, all opt-in:
  1. Cloudflare Tunnel Health Alert → owner email (free; connector-level only).
  2. Public `https://bedrock.<domain>/healthz` canary + **Upptime on GitHub Actions** every 5 min (free for public repos; ~10–15 min detection; outage mail via GitHub, independent of the home box).
  3. Optional hosted Healthchecks.io dead-man's switch on the prober (free tier 20 checks).
- **Jobs:** persist expected deadlines in the daemon (a dead scheduler throws no exception); events scheduled/started/succeeded/failed/skipped/interrupted; missed runs after restart become one gap incident, no replay. Start grace 5 min, runtime budget 10 min.
- **Default pages (only these):** public unreachability; a desired-running pebble not ready for 2 min / crash loop; a job marked critical failing or missing its deadline; backup older than 2× interval; alert delivery broken >10 min. Everything else goes to the digest.
- **Incidents before notifications:** fingerprint host/pebble/rule/job, one incident per episode, 30 s grouping, inhibit child alerts under a host/tunnel incident, silences with expiry (Alertmanager).
- **comms integration** (uses its existing API): dedicated `bedrock-monitor` client, `POST /api/v1/messages` with urgency and an idempotency key per incident transition; durable outbox. Escalation: Poke → after 15 min ntfy + email → reminder ≤ every 6 h; respects comms' 23:00–07:30 quiet hours for non-critical.
- **Digest:** weekly Monday 08:00 email; daily only when something is unresolved.
- **Status:** private `bedrock status`/`alerts`/`jobs history` (+ API); optional public status page generated by Upptime on GitHub Pages; stale = unknown, never green.
- **Burn-rate SLO alerts deferred** until traffic justifies them (SRE Workbook low-traffic caveat).

## 4. `bedrock test`
- **Local CLI, two layers:** `bun test tests/unit` (real runtime via `startPebble`, real SQLite) then Playwright (`tests/e2e/*.spec.ts` + built-in smoke). One Chromium worker; Playwright/axe are dev dependencies only.
- **Owns the server:** fresh temp home, port 0, no file watching, cron disabled (jobs invoked explicitly); requires extracting the dev launcher (today it hard-codes `.bedrock/daemon` and watches source).
- **Data:** migrations + `tests/seed.ts` into a closed template DB, copied per test; fixed IDs/dates.
- **Auth fixtures:** anonymous / owner / friend / outsider via the real dev login (`loginAs(page, 'friend')`).
- **Built-in smoke checks per declared page:** reaches an app-ready selector (not just a redirect), zero `pageerror`/`console.error`, axe WCAG A/AA (fail violations, list "incomplete"), no horizontal overflow at 1280×800 and 390×844; opt-in visual snapshots.
- **Visuals:** `toHaveScreenshot` with threshold 0.2 and 0 changed pixels, fonts bundled, animations disabled, reduced motion, a `prepareScreenshot` hook for animated controls (Anima needs a "go to named state" API); baselines from one canonical environment.
- **Flakes:** zero retries by default; optional diagnostic retry marks `flaky` and still fails; quarantine needs owner + expiry (Google, Luo et al.).
- **Output:** one JSON report (per-check status, artefact paths, repro argv); traces/screenshots on failure in `.bedrock/tests/<run>/`, pruned after 7 d / 500 MiB.
- **Config:** optional `bedrock.test.ts` `{seed, users, pages, prepareScreenshot}`; `bedrock/testing` exports Playwright `test`/`expect` + fixtures.

## Build order
1. **Daemon telemetry store + `status`/`metrics`/`logs`** (everything else reads from it).
2. **Readiness + job deadlines + incidents + comms outbox** (the few real alerts).
3. **`bedrock test`** (independent; needs the dev-launcher extraction).
4. **Error tracking** (needs the source-map prerequisite first).
5. **External watcher kit** (Upptime template + Cloudflare alert setup in `bedrock setup`).

## Owner decisions (2026-11-07)
1. **Budgets:** yes — 512 MiB telemetry, 1 GiB error payloads; telemetry and error payloads are excluded from backups (issue state may be kept).
2. **Outside monitoring:** fork one lightweight but spectacular open-source monitoring project and adapt what's needed into a **monitoring pebble** (status page, checks, incidents, history). Choose it research-based (candidates: Upptime (TypeScript, MIT, GitHub-Actions prober + static status page), Uptime Kuma (Node, MIT), Gatus (Go, Apache-2.0), Healthchecks (Python, BSD), Statping-ng). Constraint: a pebble on the home box cannot see the box go down, so keep an off-box prober (e.g. Upptime-style GitHub Actions and/or the free Cloudflare Tunnel Health Alert) feeding or complementing it. Keep the upstream licence and attribution.
3. **Pages:** as few as possible, only critical ones (the five default rules at most; trim if any isn't clearly actionable).
4. **ntfy:** checked — comms has no `NTFY_URL`, so it uses public `ntfy.sh` (external). But comms itself runs on this box, so a whole-box outage still needs the off-box path.
5. **Error tracking:** on by default, minimal by default (unhandled errors + rejections and server boundary throws only; console capture, fetch instrumentation, React boundary extras and web-vitals opt-in).
6. **Source maps:** follow best practice — deploy-time production build with external maps kept private per release, never served.
7. **Visual baselines:** (not answered) default to the home server: Linux, Playwright's pinned Chromium, bundled fonts.
8. **Linux-first resource metrics:** yes.
9. **Pilots:** babel, typewriter and comms.

## Owner decisions on the build plan (2026-11-07)
- Alerts leave the daemon through a generic webhook outbox (URL + bearer secret in daemon config); comms is the first and default target. The daemon never depends on one pebble.
- Playwright and axe are allowed as dev-only dependencies, loaded only by `bedrock test`.
- A public status page is fine if it makes sense; decide at milestone 5.

## Owner decisions for milestone 5 (2026-11-07)
- Outside canary: `https://bedrock.<domain>/healthz` (daemon/tunnel/registry liveness only, versioned marker, no per-pebble names).
- Off-box alert delivery: the Actions probe posts to the same public ntfy.sh topic comms uses (topic kept as a GitHub secret) and opens/closes a GitHub issue in the fork for email. Cloudflare Tunnel Health Alert and a Healthchecks.io watchdog stay optional, off by default.
- History: pebble keeps check results 14 days, hourly rollups 400 days, incidents forever, 64 MiB cap; public journal keeps 5-minute results 90 days and daily uptime forever.
- Archive: check results older than 14 days are archived to GitHub (compressed, append-only) instead of deleted. They name private pebbles, so they go to a separate private repository, never the public fork (confirm the repo at M5 before creating it).
