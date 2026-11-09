# Work log

## Now (checked 2026-11-08)
Goal: built-in observability, alerting, `bedrock test`, a monitoring pebble and an off-box watcher, per `docs/design/observability/DESIGN.md` (owner decisions there are binding). M0–M5 are built, reviewed (Rottweiler budget spent on both the core and M5) and live.

- **Bedrock:** branch `feat/observability`, PR https://github.com/MRoiban/bedrock/pull/8 (open, awaiting the owner's review/merge). Live daemon runs the PR head (`~/.bedrock/src`); deploy steps are in Claude's memory, DB copies are `~/.bedrock/bedrock.sqlite.pre-<sha>`.
- **Alerts:** webhook to comms client `bedrock-monitor` (https://comms.mc2.onl/api/v1/messages). Openings, resolutions and tests go to ntfy; escalation (15 min) to ntfy+email; digests to email. Never Poke (owner, 2026-11-08).
- **Monitor pebble:** `monitor` at https://monitor.mc2.onl, `access: creators`, source = public fork `MRoiban/bedrock-monitor` branch `pebble` (one squashed commit; local clone `/data/playground/bedrock-monitor`, old history only at local ref `backup/pebble-pre-squash`). Secret `MONITOR_TOKEN` = scoped token `monitor-pebble` (`*` / monitor). Archive to private `MRoiban/Lich` is off until `MONITOR_ARCHIVE_ENABLED=1` and `MONITOR_ARCHIVE_GITHUB_TOKEN` are set.
- **Off-box prober:** fork `master` (worktree `/data/playground/bedrock-monitor-prober`, branch `prober`). GitHub Actions every 5 min → journal in `status/`, issue + ntfy (comms' topic, secret `NTFY_TOPIC_URL`) after 3 failing slots, Pages at https://www.roiban.xyz/bedrock-monitor/, also served at https://mc2.onl by Cloudflare Worker `bedrock-status` (`prober/status-worker`). Outage drill passed 2026-11-07.

## Open
- Waiting on owner: merge PR #8; boot-herd proposal (health grace or staggered starts — on a cold HDD, `newspaper-nightly` misses the 15 s health gate after daemon restarts and needs a manual restart); confirm the drill's ntfy push and issue email arrived.
- Not yet observed: the monitor fetching live data with its token (needs a signed-in viewer); a real ntfy push from a Bedrock incident since the Poke→ntfy switch.
- Follow-ups, pre-existing and outside M5: requests during `supervisor.restore()` get 503 instead of joining the pebble's startup (restore is serial); a stop issued while restore is starting a pebble is undone when startup completes; daemon writes ~10 MiB/min while `observability.sqlite` stays tiny (telemetry write amplification, unmeasured); an undelivered "opened" page whose incident already resolved should become one "was down N min" note, not a late page + resolved pair.
- Accepted risk: the monitor's DB+WAL can exceed its 64 MiB cap under a pinned reader (only avoidable by pausing all writes); Bedrock's own WAL backstop bounds it.

## Undo notes
- Apex DNS: to give mc2.onl back from the Worker, delete the Worker custom domain and recreate CNAME `mc2.onl → example.com`, proxied, comment "Created during Cloudflare Rules deployment process for Instagram". The `/insta` redirect rule runs before the Worker and was untouched.

## Gotchas
- Never `git add -A` here: untracked `reports/` and `research_notes/` get committed (happened twice; `research_notes/` was stripped from history with filter-branch, backup ref `backup/observability-pre-filter`). filter-branch checkout deletes such files from disk — restore them from the backup ref.
- Run tests with `TMPDIR=/dev/shm`: `/tmp` is a small tmpfs and causes bogus ENOSPC.
- Known full-suite failures, not regressions: the two real-daemon socket backpressure tests (fail on `main` too) and "standalone react installs…", which times out at 30 s under load and passes alone with `--timeout 90000`.
- No working IPv6 on this host: curl to `*.mc2.onl` intermittently returns 000. Use `curl -4` before blaming a deploy.
- Wrangler OAuth here can deploy Workers but has no DNS or routes scope; zone DNS edits go through the tunnel cert's token (`~/.bedrock/cloudflared/cert.pem`, base64 JSON apiToken/zoneID). Never print it.
- Bedrock rejects every `BEDROCK_*` secret name ("reserved"); pebble secrets need another prefix.
- Agent-written GitHub Actions SHA pins can be fabricated (2 of 4 were). Resolve each with `gh api repos/<o>/<r>/commits/<sha>`; the fork has `check-workflow.py --remote` for this.
- In the fork, `pebble` is both a branch and a directory: use `refs/heads/pebble`, or git commands fail as ambiguous and a grep over them silently checks nothing.
- Comms routes explicit `channels` intersected with the client's allowed channels; `channels: null` falls back to urgency routing, which includes Poke. Always pass explicit channels from Bedrock.
- Pilot pebbles (comms, typewriter, babel) live under `~/.bedrock/pebbles/`; pebble data is under `/data/bedrock/pebbles/<name>/data/` (config `dataDir`).
- The monitor's visual lab needs a clean restart between scenario reruns: the stale scenario leaves its source API stopped.
- `pkill -f` can match its own shell; kill by exact PID.

## History
Detailed per-step log up to 2026-11-08 is in this file's git history (`git log -p WORKLOG.md`); outcomes are in PR #8 and the commit messages.
