# Monitoring pebble: design handoff

**Design artifact:** `design/monitoring/mockup.html` (git: see the commit that adds this file). Open it in a browser; the bar on top switches view (Overview, Pebbles, Pebble detail, Incidents, Incident detail, Review errors/jobs, Settings, Public page), scenario (all good, incident open, stale local data, first run), theme (light/dark) and width (desktop/phone). URL query `?view=&scn=&theme=&width=` selects the same.

**Design status:** selected by the orchestrator (not yet user-approved). Grounded in `docs/design/observability/09-monitoring-ux.md` (research), `05-monitoring-fork.md` (Gatus fork), `DESIGN.md` owner decisions for milestone 5.

## Visual requirements
- **Tokens:** Onyx on Flexoki from `@bedrock/ui` (`packages/ui/dist/styles.css`): surfaces app/panel/raised, text foreground/muted/description, border default/subtle/strong, tones success/warning/danger/info/neutral (fg, bg, border, solid) for light and dark. Use `@bedrock/ui` components and its stylesheet; do not hard-code colors except where the mockup's tokens map 1:1 to Onyx tokens.
- **Shell:** Typewriter-style titlebar (brand mark, "Bedrock / Monitor", time, settings button; 38 px, panel surface, bottom border). Babel UI-style 48 px activity bar on desktop with a 2 px active marker and count badges (Incidents: danger badge with open count; Review: neutral badge with new-issue count). On phones the activity bar becomes a sticky 4-item bottom nav (Overview, Pebbles, Incidents, Review) with labels; Settings stays in the titlebar.
- **Typography/density:** 13 px base (Onyx), 22–24 px page/verdict titles, 11 px uppercase section headers with 0.06em tracking (Typewriter `.tw-section-title`), tabular numerals for times and counts, mono (Lilex) only for code, cron, stack frames, logs. Rows 56 px+ desktop; touch targets ≥ 32 px desktop, ≥ 44 px phone nav.
- **State encoding (never color alone):** Ready = check-in-circle (success); Degraded/check failed = triangle (warning); Not ready/unreachable = octagon-x (danger); Unknown/stale/unavailable = dashed circle with "?" (neutral); Starting/confirming = clock (info); Idle = crescent "Available on demand"; Stopped = square "Stopped intentionally"; Hibernated = outline-moon mode pill "Hibernated · running" (mode is separate from health). Health label + one short secondary line; no stacks of badges.
- **History strip:** 48 × 30-minute fixed-time buckets per pebble row; height encodes state (short baseline = all passed, full-height = contains a failed check, hatched outline = missing evidence, 2 px dotted baseline = idle not probed, 1 px = stopped). A visible legend and an accessible text summary per strip ("N of 48 half-hours contain a failed check…"). Public page: one bar per day (30 on phone, 90 on desktop).
- **Charts (pebble detail):** requests per bucket with failures in danger color; p95 as a band (bucket range, never a fake exact value) with sample count; resident memory line + swap dashed; deploy/hibernate/crash markers as dashed vertical lines described in text under the chart (no stretched SVG text). Gaps (no process, no data) hatched, never interpolated.
- **Motion:** none except an optional ≤150 ms opacity fade on owner-initiated navigation, disabled under `prefers-reduced-motion`. No pulsing, blinking or animated icons. (Anima was evaluated and is not used in M5: the research rules out ambient status motion, and it is a private pre-1.0 runtime.)

## Responsive and state requirements
- Widths: desktop 1280, phone 390 (check 320 reflow). No horizontal page scroll at any width (the mockup measures 0 px overflow in all views).
- Every private view handles: all good, incident open, stale/unknown local data (dashed banner "Local data unavailable · last observed …", last-known counts dimmed, rows "Stale"), first run (waiting states, "Nothing to review yet", alerts not set up), idle/hibernated/stopped pebbles, loading (keep last dated snapshot; never fabricate green), filtered empty.
- Public page handles: reachable, unreachable (with redacted owner update), unknown/stale (last check age), first run (no synthetic green days). Shows "Page published HH:MM" separately from observation times. Never names a pebble.

## Integration targets (inspected in this repo)
- Data comes only from existing daemon APIs (docs/reference.md): `GET /api/status`, `GET /api/pebbles` (status, readiness, `memory`, `telemetry`, `next_retry_at`), `GET /api/pebbles/:name/metrics`, `GET /api/pebbles/:name/logs`, `GET /api/alerts` (+ `POST /api/alerts/silence`, `POST /api/alerts/test`), `GET /api/jobs/:pebble/history`, `GET /api/pebbles/:name/errors` (+ resolve/ignore/merge), backup state via status/doctor data.
- The pebble reaches the daemon at `BEDROCK_API_URL` with a bearer token from its secrets (`bedrock secrets set monitor BEDROCK_MONITOR_TOKEN`). Today scoped deploy tokens only have `deploy, lifecycle, logs, secrets, status, service-tokens` (src/daemon/token-scope.ts:3), so alerts/errors/metrics/jobs-history need an unscoped token. Add a least-privilege **`monitor`** action (read status/metrics/logs/alerts/errors/jobs history + create silences + send alert test; no lifecycle, deploy or secrets) in the bedrock repo.
- Server-side: the pebble polls the daemon (detached work, not inside write slots) every 30 s while a viewer is connected and caches the last dated snapshot in its own SQLite (Drizzle) so stale data stays dated; monitoring check results 14 d, hourly rollups 400 d, incidents kept, 64 MiB cap (owner decision). Off-box observations are imported from the public journal.
- Client: React with `@bedrock/ui` (`AppShell` or the Typewriter-style frame), `bedrock/react` `useQuery` for live data, `sync: true`.
- Access: `access: "creators"`.

## Simulations to replace
Everything in the mockup's `/* mock data */` block: pebble list, strips, charts, events, incidents, errors, jobs, backups, outside-probe status and public history. The scenario switcher and controls bar are mockup-only and must not ship.

## Ownership
1. **Bedrock repo agent:** `monitor` scope action (token-scope.ts, api.ts authorization, docs), any small API addition the app genuinely needs (e.g. a backup-age field on status if missing), tests. One commit.
2. **Monitoring pebble agent:** the private app in the fork repo (`pebble/`), from the Gatus-derived model (05-monitoring-fork.md) and this design; Apache-2.0 NOTICE/attribution for ported Gatus pieces.
3. **Off-box kit agent:** `prober/` GitHub Actions workflow (`2-57/5 * * * *`, `https://bedrock.<domain>/healthz`), append/compact public journal (5-min results 90 d, daily uptime forever), ntfy push to the comms topic (GitHub secret) and open/close a GitHub issue on outage/recovery, static public page export matching the mockup's Public view, plus a `bedrock setup`-style doc step. Nothing private (pebble names, URLs other than the canary) may enter the public repo, journal, page assets or Actions logs.

## Acceptance
- Visual: implemented screens match the mockup at 1280 and 390 px in light and dark for every scenario above (screenshots side by side); no horizontal overflow; axe WCAG A/AA clean (use `bedrock test` smoke checks on the pebble).
- Integration: real data from a temp-home daemon; stale handling verified by stopping the daemon API; idle pebbles never woken by the monitor; no daemon write slot held by the monitor; scoped `monitor` token cannot deploy, change lifecycle or read secrets.
- Public: the exported page and journal contain only the canary, times, results and redacted incident text (grep the built artifacts for every pebble name → none).
- Open assumptions: archive of >14-day check results to a private GitHub repo needs the owner to confirm the repo name before it is created; outside-probe ntfy topic secret must be set by the owner.
