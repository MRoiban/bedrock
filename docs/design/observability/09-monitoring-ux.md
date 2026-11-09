# Monitoring UX: one owner, a phone, and a public “Home cloud”

Research checked **2026-11-07**, Bedrock checkout `b346eec`. Recommendations below are design proposals, not implemented behavior or usability-test results. Primary evidence: public pages, official documentation/screenshots, pinned upstream UI source, and explicitly labelled first-hand feedback. “Best” here means useful for this owner's decisions, not a product ranking.

Read [ARCHITECTURE](../../../ARCHITECTURE.md), [DESIGN](DESIGN.md), [04](04-uptime-alerting.md), [05](05-monitoring-fork.md), and the current reference sections on [readiness/alerts](../../reference.md#readiness-jobs-and-alerts), [telemetry](../../reference.md#daemon-telemetry), and [errors](../../reference.md#error-tracking). The current reference wins over earlier proposals: four daemon page conditions; delivery failure is a **local-only** incident; no acknowledgment API; idle is available on demand; hibernation still means running; readiness older than 65 seconds is unknown. This report changes no daemon contract, pebble-author primitive, dependency, or fork choice. Keep Gatus's Apache-2.0 attribution when porting selected UI to React. [Gatus licence][g-license]

## 1. Recommendation

Build a quiet, exception-first private app: **“Does anything need me?” → “What happened?” → “What can I do?”** Keep Gatus's named state and compact history, Kuma's easy monitor drill-through, Healthchecks/Cronitor's deadline vocabulary, and incident tools' evidence timelines. Put full graphs one level deeper. Publish a separate, independently hosted page containing exactly one component, **Home cloud**, with observation time and redacted outage history. Its default claim must be **public reachability**, because the approved `/healthz` does not test individual applications. [Gatus card][g-card], [Kuma screenshot][k-screen], [Healthchecks states][hc], [Cronitor][cron], [canary contract](../../reference.md#readiness-jobs-and-alerts), [approved external design](05-monitoring-fork.md#5-concrete-adaptation-and-external-coverage)

### Fourteen patterns to adopt

1. **One sentence before any chart.** GitHub/Vercel lead with an overall status; Linear uses a short plain-language headline before system detail. Bedrock: “Nothing needs attention” only when required evidence is fresh, or “1 incident needs attention”, followed by its target, age, and one **Investigate** link. Add a separate coverage line, so an open outage and stale evidence can coexist. This gives a phone opened from a push an immediate answer. [GitHub][github-status], [Vercel][vercel-status], [Linear][linear-status]

2. **Put exceptions first, keep the rest findable.** Sentry offers a prioritized issue stream; Bugsink starts with open issues and supports recency/volume sorts. Show actionable incidents first, then data-quality problems, then a compact fleet summary. Do not silently hide ignored issues: show filter counts and an explicit All view. Use transparent rules rather than an opaque score for 25 apps. The owner should not scan 25 equally prominent green cards. [Sentry priority][sentry-priority], [Bugsink triage][bugsink]

3. **Name the thing and its state in the same row.** Gatus places an endpoint name and Healthy/Unhealthy badge above its strip; Kuma keeps a selectable monitor list beside one detail. Port that hierarchy into compact rows: name, health label, observation age, small history, and secondary operating mode. A row opens details; no separate tiny arrow is required. This preserves fleet scanning while fitting a single phone column. [Gatus card][g-card], [Kuma screenshot][k-screen]

4. **Make “not observed” a first-class result.** Healthchecks distinguishes New, Up, Late, Down, Paused; Grafana distinguishes evaluation errors from no data. Gatus pads missing result slots gray and returns unknown without results, but its card derives health from the latest result without an age check. Bedrock must additionally age that evidence: initial, disconnected, unsupported, expired and intentionally not probed all need words. No green skeleton, zero-filled chart, or stale success badge. [Healthchecks][hc], [Grafana no-data][grafana-nodata], [Gatus card][g-card], [Bedrock freshness](../../reference.md#readiness-jobs-and-alerts)

5. **State is color + symbol + words.** Gatus/Kuma supply useful textual status labels, but their dense history examples rely heavily on red/green. Adopt explicit symbols and a textual history alternative, using W3C's rule that color cannot carry meaning alone. A moon plus “Idle · available on demand” is more useful than either a red dot or an unearned green check. This works in sunlight, grayscale, and with assistive technology. See §5 for tokens. [Gatus screenshot][g-screen], [Kuma screenshot][k-screen], [W3C color][a-color]

6. **History needs a clock, a legend, and a route to the incident.** Atlassian's daily uptime showcase links downtime days to affected incidents. OpenStatus explicitly distinguishes check-count, duration and manual-report calculations. Use fixed wall-clock buckets, known/unknown coverage and tap-to-inspect intervals; keep current health separate from historical uptime. The owner can answer “just now or all afternoon?” without decoding a sparkline. Gatus's latest-50-results strip is useful evidence, but not a shared time scale. [Statuspage uptime][atlassian-uptime], [OpenStatus reference][openstatus-ref], [Gatus card][g-card]

7. **Start an incident with evidence and a repair route.** Better Stack advertises captured errors, screenshots and a fine-grained incident timeline. Bedrock need not add screenshot capture: show the failed readiness condition, first/last observation, threshold progress, affected pebble, recent crash/deploy, and a link to bounded logs or the relevant repair command. Distinguish measured facts from a suggested cause. One useful next action beats a row of unexplained red metrics on a phone. [Better Stack Uptime][better-uptime], [Bedrock diagnostics](../../reference.md#daemon-telemetry)

8. **One episode, one readable timeline.** PagerDuty timelines combine status/actions/notifications and allow event filtering; incident.io describes key-event timelines; Rootly's timeline design emphasizes a summary above source-linked moments. Bedrock should combine existing incident transitions, lifecycle/job evidence and available outbox metadata, in timestamp order, with a short deterministic summary. Show receipt time separately for late off-box imports. Default to meaningful transitions; expand repeated failures. No Slack, roles, meeting recorder or AI summary is needed for one owner. [PagerDuty][pd], [incident.io timeline][incident-timeline], [Rootly timeline][rootly-timeline]

9. **Show notification disposition without changing health.** PagerDuty distinguishes acknowledgment from resolution; Bugsink distinguishes muted from resolved. Bedrock already has expiring silences and host/tunnel inhibition, but no acknowledgment. Show “Open · silenced until 22:00” or “Notifications inhibited by tunnel incident”, preserving the failure and evidence. Use “Accepted by webhook”, never “Delivered to phone” or “Seen”. This prevents a silence from looking like a fix. [PagerDuty lifecycle][pd], [Bugsink alerts][bugsink-alerts], [actual Bedrock outbox/silence contract](../../reference.md#readiness-jobs-and-alerts)

10. **For jobs, lead with the next obligation.** Healthchecks exposes schedules/grace and Late before Down; Cronitor correlates run/complete/fail and supports duration assertions. A Bedrock row should say “Due 02:00 Europe/Brussels · grace until 02:05”, “Running 8m / 10m budget”, or “Overdue by 12m”, alongside last success. Mark critical jobs explicitly; ordinary failures belong in review/digest. This reveals a job that never ran, which an error-only list misses. [Healthchecks configuration][hc-config], [Cronitor][cron], [Bedrock deadlines](../../reference.md#readiness-jobs-and-alerts)

11. **Group errors into work, not an exception firehose.** Bugsink lists grouped issues with counts/last-seen/trends; Sentry prioritizes actionable issues. Show exception, pebble, runtime, first/last seen, recurrence count and release, with Resolve/Ignore on detail and visible regressions. Do not promise affected-user counts: Bedrock deliberately does not collect identities. Existing daily count buckets support daily trends; do not invent hourly sparklines. This makes weekly review manageable without paging for each exception. [Bugsink][bugsink], [Sentry][sentry-priority], [Bedrock error schema/retention](../../reference.md#error-tracking)

12. **Use service outcomes to enter diagnosis.** Datadog service pages collect throughput/errors/latency; Grafana Drilldown favors selecting/filtering over writing queries; Render pairs service graphs with logs. Start pebble detail with request volume, failed/completed and headers-ready p95 range, then CPU/memory/swap. Share the time window when opening events/errors/logs. The phone user follows a failure to evidence rather than assembling a dashboard. Empty traffic means “No requests in this window”, not proof of application correctness. [Datadog resource graphs][dd-resource], [Grafana Drilldown][grafana-drill], [Render][render], [Bedrock metric semantics](../../reference.md#daemon-telemetry)

13. **Keep deployment and diagnosis in the same context.** Fly's official app-page design brings preview metrics, deployment details and activity together; Vercel exposes route-level errors/requests with drill-down; Coolify separates platform/workload health from historical metrics. Bedrock detail should annotate deploy, wake, restart and crash on the same clock as symptoms. Keep selection/time range when going back to the fleet. A spike after a deploy is correlation, not a proven cause. [Fly design][fly-design], [Vercel observability][vercel-obs], [Coolify boundaries][coolify]

14. **Design the push landing and weekly return, not a wallboard.** PagerDuty's mobile guide documents incident details with latest updates and a shorter timeline before the full one; incident.io publishes mobile status-page examples. Push should link directly to the relevant private incident after authentication; a resolved incident remains a useful destination. The weekly review should summarize unresolved work, regressions, missed jobs, backup freshness and monitoring gaps, linking into detail. Keep Bedrock's existing weekly/daily policy rather than introducing more reminders. [PagerDuty mobile][pd-mobile], [incident.io mobile examples][incident-status], [Bedrock digest policy](../../reference.md#readiness-jobs-and-alerts)

## 2. What the tools actually contribute

This is an evidence map, not a claim that every product meets all accessibility or mobile requirements. Public fetches establish content/hierarchy; source establishes behavior; inspected upstream screenshots establish appearance only. No authenticated commercial app was exercised.

| Tool / example | Observed or documented pattern | Adopt / limit for Bedrock |
|---|---|---|
| **Atlassian Statuspage** | 90 daily bars, a separate uptime history page, downtime tooltips linking affected incidents; history can be manually corrected. [Docs][atlassian-uptime] | Borrow history-to-incident navigation. Label human reports separately from measured probes. |
| **incident.io status pages** | Official mobile examples; integrated update workflow; Linear's live page puts a short summary before components and calendar. [Product][incident-status], [Linear][linear-status] | Borrow calm hierarchy; no audience segmentation or enterprise workflow. |
| **Better Stack status pages / Uptime** | Own page shows updated time, 30-day strips and prior incidents; monitoring presentation offers captured failures and timeline. [Live][better-status], [Product][better-uptime] | Borrow freshness/evidence. Screenshot capture is outside existing Bedrock data. |
| **Instatus** | Components can have optional history/groups; main-status rules can name the single affected component. Example history offers a “Read uptime graph” control and timestamped updates. [Components][instatus-components], [Aggregation][instatus-main], [Example][instatus-example] | Borrow explicit aggregation and readable history alternative. Never let generated public wording include a pebble name. |
| **OpenStatus** | Own page combines daily history, a labelled p75 response time and an events-history link; reference distinguishes manual impact from monitor-derived bars. [Live][openstatus-live], [Reference][openstatus-ref] | Borrow labelled provenance and calculation semantics; not its multi-region surface. |
| **Upptime** | Demo offers 24h/7d/30d/1y/all; docs separate Actions probes, Issues incidents, Pages presentation and daily response graphs. [Demo][upptime-demo], [Docs][upptime] | Borrow independent hosting and deep history. A generated daily graph is not a live latency chart. |
| **Gatus** | Inspected screenshot: compact dark card grid, search/filter/sort, state pills and result strips. Source: null padding, latest-result status, per-result hover/click, response average/range. Detail includes health events. [Screenshot][g-screen], [Card][g-card], [Detail][g-detail] | Keep selected visual code/provenance, port to React; add freshness, lifecycle modes, accessible history and incident links. |
| **Uptime Kuma dashboard / status page** | Inspected official screenshot: selectable monitor sidebar, heartbeat strip, response/uptime summaries, latency plot. Pinned heartbeat implementation includes canvas summary, server-aggregated ranges, explicit no-data/status labels and custom tooltip. Status-page communications have separate incident data. [Screenshot][k-screen], [Heartbeat][k-bars], [Status page][k-page] | Borrow monitor-to-detail continuity. Do not make the desktop sidebar or a tiny heartbeat the only navigation. |
| **Cachet** | Live demo shows grouped component labels, maintenance, dated incidents and successive updates, including an explicitly unresolved example. [Demo][cachet] | Borrow plain chronological communications; identify demo evidence as mutable, not a production reliability record. |
| **GitHub / Cloudflare / Vercel / Linear** | GitHub/Vercel: overall headline, component hierarchy, legend/history and incident updates. Cloudflare fetch: active/recent incidents, maintenance and local-time control. Linear: concise headline, region components and calendar. [GitHub][github-status], [Cloudflare][cloudflare-status], [Vercel][vercel-status], [Linear][linear-status] | Borrow headline, dated updates and timezone clarity; not worldwide region trees. Cloudflare's client-rendered component details were not verified. |
| **Healthchecks.io / Cronitor** | New/late/down/paused distinctions; period/schedule/grace; start/completion/failure and duration monitoring. [States][hc], [Configuration][hc-config], [Cronitor][cron] | Borrow due time, run budget and explicit first-run state. Their heartbeat model is not an inbound availability probe. |
| **incident.io / PagerDuty / Rootly response** | Key-event narratives, timestamped lifecycle/actions, filtering and source-linked summaries. [incident.io][incident-timeline], [PagerDuty][pd], [Rootly][rootly-timeline] | Borrow evidence continuity. Team rosters, severity taxonomies and AI generation add little here. Rootly's cited feature is Slack early access, not a verified web/mobile UI. |
| **Sentry / Bugsink** | Priority/open queues; grouping, recurrence, counts, last-seen and trends. Bugsink warns that independently scaled sparklines cannot compare volume by height. [Sentry][sentry-priority], [Bugsink][bugsink] | Borrow issue triage. Keep exact counts visible and privacy-compatible fields only. |
| **Grafana / Datadog** | Queryless drill-down, service-centric telemetry, error and latency graphs. Grafana documents distinct no-data/evaluation-error states. [Drilldown][grafana-drill], [Datadog][dd-resource], [No data][grafana-nodata] | Borrow navigation and semantics; no query editor, dashboard builder, service map or extra stack. |
| **Vercel / Railway / Fly.io / Render / Coolify app dashboards** | Project/service context with diagnosis: Vercel observability, Railway navigation redesign and resource metrics, Fly app activity/monitoring, Render resource/HTTP graphs, Coolify health versus historical metrics. [Vercel][vercel-obs], [Railway layout][railway-layout], [Railway metrics][railway-metrics], [Fly][fly-design], [Render][render], [Coolify][coolify] | Borrow scoped detail and contextual links. Distinguish source/scope: resources alone cannot prove request health; Render explicitly scopes HTTP graphs to public traffic. |

### What people praise or struggle with

- **Findability matters even in an attractive app.** In Fly's 2022 official design thread, users praise the update, but one describes repeatedly missing the route back to the current organization's apps; another asks why a Machines view is empty while VMs run. These are historical first-hand comments, not findings about today's Fly dashboard. Bedrock implication: an obvious **All pebbles** return and empty-state explanations, with no organization switcher. [Thread][fly-design]
- **Prioritization has some directional support.** Sentry reported its own developers preferred its new priority sort 3:1 over last-seen in 2023. This is a vendor-reported internal preference, not an independent study or a result for home-server owners. It supports testing an exception-first default, not copying its scoring algorithm. [Changelog][sentry-feedback]
- **Small screens can reward a dedicated layout.** An early Kuma launch discussion includes explicit praise for the mobile layout and requests for grouping; it is anecdotal and dated. Bedrock should validate its own phone flows rather than assume responsive CSS proves usability. [First-hand launch discussion][k-feedback]
- **Density has a performance cost.** Kuma issue #6181 reports approximately 15-second dashboard loads around 900 monitors on 2.0.0-beta.3; another commenter reports a blank dashboard with fewer than 100. This is version/workload-specific, not a benchmark at 25 pebbles and not proof of a particular rendering cause. Bedrock implication: load current summaries first, history/detail on demand; measure the 25-row phone case. [Issue][k-density]

## 3. Anti-patterns to avoid

| Anti-pattern | Evidence and implication |
|---|---|
| **A last-known success presented as current green** | Gatus card uses the last stored result; Grafana documents no-data separately; Actions schedules can be delayed or dropped. Add observation age, expiry and an unknown state, including on a frozen static page. [Card][g-card], [Grafana][grafana-nodata], [Actions][gh-schedule] |
| **A count-based strip masquerading as equal elapsed time** | Gatus pads/slices the last N results, and its screenshot includes strips spanning different durations. Never compare their lengths as downtime durations or omit missing slots. Use §5's fixed-time bins. [Card][g-card], [Screenshot][g-screen] |
| **A percentage replacing the incident** | Statuspage's uptime is a historical, editable communication record; OpenStatus offers different calculation bases. A high historical percentage cannot answer whether a service is usable now. Keep incident/state/coverage above the percentage and label its basis. [Statuspage][atlassian-uptime], [OpenStatus][openstatus-ref] |
| **One green/red dot, hover-only evidence, or tiny bars as the only controls** | Gatus's bars have mouse/click handlers but no per-bar keyboard semantics; Kuma's desktop screenshot is dense. W3C requires redundant color meaning and defines target-size requirements. Supply labelled rows, keyboard/touch history navigation and a text event list. This is a source review, not a full accessibility audit of either upstream. [Card][g-card], [Kuma][k-screen], [Color][a-color], [Targets][a-target] |
| **Deleting short outages to improve the story** | Upptime's introductory docs describe deleting incidents shorter than 15 minutes. Keep Bedrock observations and distinguish an isolated failed check from a confirmed incident; neither should vanish from measured history. This is a documented Upptime policy, not a verified statement about every current deployment. [Upptime][upptime] |
| **A CPU wall, averages only, or fake decimal p95** | Render/Datadog expose request outcomes and percentile charts; Bedrock p95 is a histogram interval, and missing coverage is unknown. Show failed/completed + count, p95 bounds and scope; CPU/memory are diagnostic. Never average percentiles or connect unknown gaps. [Render][render], [Datadog][dd-resource], [Bedrock](../../reference.md#daemon-telemetry) |
| **Resolving by muting, or declaring push delivery from HTTP 2xx** | PagerDuty treats acknowledgment and resolution separately; Bedrock silences affect notification eligibility and webhook acceptance proves only submission. Do not add a misleading Ack button or turn a muted incident green. [PagerDuty][pd], [Bedrock](../../reference.md#readiness-jobs-and-alerts) |
| **Copying enterprise navigation or public component names** | Vercel's public page has many product/region components; Instatus's single-component failure wording incorporates its name. This owner's public projection must never contain private names, including in JSON, tooltips, incident titles, feeds, paths or accessibility labels. [Vercel][vercel-status], [Instatus][instatus-main], [approved privacy boundary](DESIGN.md#owner-decisions-for-milestone-5-2026-11-07) |
| **A monitoring page in the same failure domain as its only evidence** | Upptime separates probes/incidents/site using GitHub; Coolify explicitly limits built-in monitoring's external coverage. The home pebble cannot be the only status destination during home failure. Always link to the independent public page; do not make that page fetch home to become useful. [Upptime][upptime], [Coolify][coolify], [external design](05-monitoring-fork.md) |

## 4. Recommended information architecture

All routing/layout below is proposed. Use **five top-level destinations**, with the first four in labelled phone bottom navigation and Settings in the header menu; the desktop can use the same labels in a narrow sidebar. No separate top-level Metrics, Logs, Backups, Jobs, Deployments or Status-page-builder destinations. This applies the scoped drill-through and findability lessons above. [Grafana][grafana-drill], [Fly feedback][fly-design]

| Destination | First screen and drill-down | Owner's next action |
|---|---|---|
| **Overview** | Verdict + independently dated Local / Outside / Alerts evidence; open incident cards ordered by actionable impact; coverage warnings; compact fleet mode counts; backup freshness summary; small weekly-review summary link. Healthy fleet list remains below the exceptions, not a wall of charts. | Open the relevant incident, pebble, backup problem or outside probe. “Nothing needs attention” still lists unresolved review items separately. |
| **Pebbles** | Search + All / Needs attention / Available on demand / Stopped filters with counts. Default ordering: failures, unknown, healthy, intentional idle/stopped; alphabetical within groups. Each row: name, health, age, mode, 24h strip; brief failure text when needed. Detail: current state/readiness, RED, resources, deploy/crash/wake annotations, check conditions, backup age, jobs/errors, bounded logs. | Inspect a failure and follow its repair hint. Show existing CLI command/link when no safe API action exists. Do not create lifecycle automation to fill a dashboard button. |
| **Incidents** | Open first, Resolved and Silences as subordinate filters. Detail: impact, rule/threshold, episode age, latest evidence, notification disposition, next action, then timeline; preserve link after recovery. Related tunnel/host incident explains inhibited children. | Investigate or use the existing expiring silence. Resolution follows evaluator recovery; no invented acknowledgment or manual-resolution API. |
| **Review** | Jobs / Errors / Digest subordinate views, not a mixed undifferentiated event feed. Jobs: overdue and critical first, schedule/timezone/grace, next due, last success, run history/budget. Errors: grouped issues, open/resolved/ignored, counts/last seen/release, daily trend if counts exist; detail with redacted stack and missing-map warning. Digest: existing policy, a bounded summary of the same evidence and links. | Resolve/ignore an error, inspect a missed job, review backup gaps. UI does not imply stored digest archives or read/unread tracking exist; either render from available data or explicitly implement that storage in M5. |
| **Settings** | Monitoring setup/connection, actual collection cadences and retention, external-probe status, active silences, notification destination readiness and Test result, weekly schedule/timezone, public-page link + disclosure explanation. Secrets are never displayed in responses. | Finish setup or repair a failed route. Test says Queued/Accepted/Failed; no “phone received” check without evidence. |

**Shared detail behavior:** use a single global time-range control per detail page (1h / 24h / 7d / custom within available retention), preserve scope/range in URLs, and keep Back at the same list position. A phone shows summary → primary action → evidence, one chart per row. Desktop may put two related charts side by side. On refresh, do not reorder the row under a finger or replace the entire page; offer “3 updates” while the owner is inspecting history. These are recommendations derived from scoped navigation, not verified vendor mobile behavior. [Grafana drill-through][grafana-drill], [PagerDuty mobile][pd-mobile], [W3C status messages][a-status]

### Private states: apply to every destination

| Situation | Required presentation / action |
|---|---|
| **All good** | “Nothing needs attention” + checked-at times and known coverage; quiet fleet summary. Jobs show next due and backup age remains visible. Errors can still have non-paging review work; say so. |
| **Degraded, no incident yet** | “Readiness degraded · observed 18s ago”, failed condition and “2 of 3 failed checks” where evidence exists. Show the current fact without claiming a page has fired; daemon opening/readiness timing stays unchanged. |
| **Incident open** | Prominent affected target/rule/age, deep link and next action; keep the open incident even when evidence subsequently becomes stale. If silenced/inhibited, show why and until when; never suppress it from Open. |
| **Stale / unknown / disconnected** | Distinct banner per source: “Local data unavailable · last observed 12m ago”; old readings visually historical, unconnected chart gaps, retry and independent-public-page link. Missing outside data does not erase fresh local diagnosis. Unsupported cgroups say Unavailable, not 0 MiB. |
| **Idle / hibernated / intentionally stopped** | Idle: “Available on demand · not probed”, no fake latency/CPU, no wake from opening monitoring. Hibernated: still running, mode label separate from actual readiness/resources. Intentional stop: neutral “Stopped intentionally”; unexpected desired-running failure remains an incident candidate. Backup age still matters for sleeping/stopped data. |
| **Loading** | Stable neutral placeholders + “Loading observations”; no success labels or fabricated uptime. On background refresh retain the previous dated snapshot, with its freshness ageing normally. Partial endpoint failure affects only that section. |
| **Empty first-run / filtered empty** | Distinguish “No pebbles found”, “Waiting for first observation”, “No jobs configured”, “No issues captured yet”, “No results match this filter”, and “Alerts not configured”. Offer the appropriate setup/reset-filter action. An empty issue list cannot establish successful error ingestion. |

State semantics come from the current [readiness/alerts](../../reference.md#readiness-jobs-and-alerts), [telemetry](../../reference.md#daemon-telemetry) and [error](../../reference.md#error-tracking) contracts. The loading/empty copy is proposed; it follows Healthchecks's explicit New state and Grafana's no-data distinction. [Healthchecks][hc], [Grafana][grafana-nodata]

### Public page: one component, one independent source

Order: **Home cloud headline → observation age/scope → current redacted incident/update → daily history → recent resolved incidents → what this measures**. No private navigation, app counts, service selectors, logs, error text, metrics dashboard or sign-in requirement. Use a small centered column, approximately 640–760 px maximum, equally readable on a phone. Borrow Linear's concise summary, Statuspage's dated history and Upptime's independent hosting. [Linear][linear-status], [Statuspage][atlassian-uptime], [Upptime][upptime]

The initial source is the off-box `https://bedrock.<domain>/healthz` observation journal. Use **“Home cloud — reachable”**, not “All apps operational”. Explain: “External check of the home gateway and daemon, normally every 5 minutes; individual apps are private and are not tested here.” A fresh canary success cannot disprove a private incident. If aggregate application degradation is published later, it requires a deliberately sanitized, separately dated aggregate signal and a defined expiry; never infer it from this canary or publish the private incident object. That extra feed is **not** assumed available for M5. [Approved canary/privacy/retention](DESIGN.md#owner-decisions-for-milestone-5-2026-11-07), [current canary scope](../../reference.md#readiness-jobs-and-alerts)

| Public situation | Required result |
|---|---|
| **All good within measured scope** | Check-circle + “Home cloud — reachable”, observed-at age, fixed scope note; historical probe success and coverage are secondary. |
| **Single failed check / degraded evidence** | Amber warning “Latest external check failed · confirming”; show last successful and latest attempted check. Do not wait for three failures to conceal the observation; confirmed outage notifications still use the chosen policy. No “some apps degraded” inference. |
| **Confirmed incident open** | Red failure symbol + “Home cloud — unreachable”, opening time, latest redacted update and latest observation. Say unreachability, not a claimed cause such as power failure. Recovery verification can read “Checks passing · confirming recovery” until the required second success. |
| **Stale / unknown** | Dashed question-circle + “Current status unknown · last check …”. Preserve an unresolved incident as “Last known incident remains unresolved”; do not falsely resolve it or assert continued downtime without evidence. A proposed outside-evidence expiry is 15 minutes, clearly longer than the nominal 5-minute schedule, not a guarantee. |
| **Idle pebbles** | Nothing individual appears. Idle is an intentional private operating mode and does not change canary reachability. Never publish names/counts to explain it. |
| **Loading / script disabled / frozen export** | Static HTML says “Last observation at [absolute time]: [result]”; only client age validation may assert current freshness. “Checking current status” is neutral. If the latest journal cannot load, retain dated history and show current unknown. An old generated green must not survive indefinitely with JS disabled. |
| **Empty first-run** | “Waiting for the first external observation”; history says No observations yet, percentage is —, coverage is 0; no synthetic green days. |

These are proposed presentation rules, grounded in [unknown-on-stale design](DESIGN.md#3-uptime-jobs-alerting-status), [Healthchecks New/Late states][hc] and [Actions scheduling caveats][gh-schedule]. Show `observed_at`, journal receipt/import time when relevant privately, and page publication time as different fields. Publishing or fetching a snapshot does not freshen its observations. Detect age on initial load, periodically while visible, and when a suspended phone tab resumes. If the device clock cannot be trusted, retain dated wording rather than promise current health. No local app request is needed for the public page to render.

## 5. Concrete visual guidance

All dimensions, palette values, bins and motion timings here are **proposed defaults** to test, not measurements of upstream products. Follow the existing Bedrock UI where it already supplies equivalent tokens. Public and private share semantics, not data payloads.

### State vocabulary and accessible encoding

Keep **health**, **operating mode**, **incident disposition**, and **freshness** separate. A running process is not necessarily ready; a resolved incident is a historical fact, not a fresh probe. Prefer one primary health label plus a short secondary sentence over four equally loud badges. [Bedrock state contract](../../reference.md#readiness-jobs-and-alerts), [PagerDuty lifecycle][pd]

| Meaning | Light-surface foreground token | Shape / explicit label |
|---|---|---|
| Fresh readiness success / public reachability success | Green `#166534` | Circle containing check; **Ready** / **Reachable** |
| Measured degradation / failed check awaiting confirmation | Amber `#92400E` | Triangle containing exclamation; **Degraded** / **Check failed · confirming** |
| Confirmed failing readiness / public outage | Red `#B91C1C` | Octagon containing cross; **Not ready** / **Unreachable**; mode may separately say Crashed |
| No evidence, stale, unsupported or disconnected | Slate `#475569` | Dashed circle containing question mark; **Unknown**, **Stale**, or **Unavailable**, with reason/time |
| Starting / recovery verification | Blue `#1D4ED8` | Clock; **Starting** / **Confirming recovery**; no perpetually spinning “healthy” indicator |
| Intentional idle | Slate `#475569` | Crescent; **Idle · available on demand** |
| Intentional stop | Slate `#475569` | Square; **Stopped intentionally** |
| Hibernation mode | Slate `#475569` | Moon-outline mode icon + **Hibernated · still running**; readiness remains independent |
| Notification silence / inhibition | Slate `#475569` | Crossed bell / linked-parent icon; **Silenced until …** / **Inhibited by …**; retain health color elsewhere |
| Historical resolved incident | Green `#166534` | Check + **Resolved at …**; never replaces current observed health |

The listed foreground colors calculate to 6.47–7.58:1 contrast on white using the WCAG relative-luminance formula; they are **not** approved dark-mode tokens or proof of whole-UI conformance. Use tinted backgrounds sparingly and recheck actual text/icon/background combinations. Normal text ≥4.5:1; meaningful non-text boundaries/icons ≥3:1 where WCAG applies; never distinguish status by hue alone. Test grayscale and common color-vision deficiencies. Charts need line styles/markers and text summaries, not just red/green legends. [W3C color][a-color], [text contrast][a-contrast], [non-text contrast][a-nontext]

### History strips and uptime semantics

| Location / range | Proposed displayed bins | What selection reveals |
|---|---|---|
| Private fleet row, last 24h | **48 × 30-minute** fixed buckets | One accessible History action opens detail at that interval; strip itself has a text summary of failures/unknown time. |
| Check detail, last 1h | **60 × 1-minute**, normally two local probes each | Timestamp/timezone, observed/expected checks, pass/fail, pending versus confirmed incident, probe duration if actually available. Raw check records remain accessible within 14-day retention. |
| Check detail, last 24h / 7d | **48 × 30-minute / 56 × 3-hour** buckets | Exact interval, bad samples/transitions, coverage and related episode links. Chart metrics may have different documented rollup resolution. |
| Long history, private/public | **One day per bin**; public 30 days on phone, 90 on wide screens, previous/next 30-day pages on phone | Passed/failed/expected external checks, gaps, incident/update links. Public 5-minute observations remain distinct from local 30-second checks. |

Rationale: visible wall time rather than sample count; Statuspage's daily incident links; OpenStatus's explicit calculation basis. Finer information belongs in selectable detail rather than 2,880 tiny local-check buttons per day. This is not a new retention policy: monitoring checks retain 14 days, hourly rollups 400 days, public 5-minute results 90 days per owner decision; daemon telemetry has separate tiers and may have shorter coverage under byte pressure. Do not promise raw checks after archival or uniform precision across products. [Statuspage][atlassian-uptime], [OpenStatus][openstatus-ref], [owner retention](DESIGN.md#owner-decisions-for-milestone-5-2026-11-07), [telemetry tiers](../../reference.md#daemon-telemetry)

- **Never collapse a gap.** Empty scheduled slots use neutral diagonal hatching; intentional not-probed idle uses a distinct dotted band and “Not probed · idle”. A solid green bucket requires complete expected evidence with no failures. Mixed coverage uses hatching plus its known-result indicator; a failed observation is not averaged away by many successes. Encode success as a short baseline mark, a failure-containing bucket as a full-height notch, unknown as an outlined/hatch mark, and idle as a dotted baseline; the legend must say height encodes state, not latency. Mark confirmed incident intervals separately from isolated failed checks, and describe a red bucket as “Contains failure”, not “Down for 30 minutes”. [Gatus latest-N limitation][g-card], [OpenStatus calculation modes][openstatus-ref], [Bedrock unknown coverage](../../reference.md#daemon-telemetry)
- **Do not conflate check success and continuous uptime.** For automated bars, display `successful observations / completed observations` as **Probe success**, alongside `observed scheduled slots / expected slots` as **Coverage**. Failed/time-out attempts are completed failures; missing runs are unknown. Deduplicate retries by scheduled observation identity. No observations means —, not 100%. A known partial history must not look like a complete 100% record. If later showing elapsed availability, use explicitly defined state intervals and report unknown duration separately. Manual incident-impact history remains a different series. [OpenStatus semantics][openstatus-ref], [Statuspage editable history][atlassian-uptime], [Actions gaps][gh-schedule]
- **Use touch and keyboard detail, not hover as a requirement.** A whole strip can open a bottom sheet/detail with Previous/Next interval buttons, large date selection, textual pass/fail/unknown counts and incident links. Desktop hover is an enhancement. Give the strip a concise accessible name, and a table/list alternative; do not put every narrow bar in the tab sequence. Keep timestamps and “30 minutes per bar” visible. [W3C targets][a-target], [color alternatives][a-color], [Gatus interaction source][g-card]

### Charts: a small set, with truthful units

| Question | Recommended chart / annotation |
|---|---|
| Are requests failing? | Count bars for completed/failed requests with numeric `failed / completed`; optional separate error-rate line/panel, not an ambiguous dual axis. Keep traffic class explicit, default ordinary HTTP. Zero requests is distinct from missing writer coverage. |
| Is it slow? | Headers-ready p50/p95 **interval bands/steps** only where available, or p95 alone plus count; label e.g. `p95 (75,100] ms · 126 samples`, overflow `>10s`. Never invent decimal quantiles or mix stream lifetime with headers-ready time. Separate probe round-trip latency from request latency. |
| Is the process constrained? | Aligned CPU line (% of one core), memory and swap lines in separate byte-scaled panels; peaks/limits only if known. Idle/unsupported shows no sample. Do not infer “OOM” from SIGKILL alone. |
| Did a deploy/wake cause a change? | Shared x-axis with labelled deploy/wake/crash markers, selectable event detail and links to scoped logs. Avoid causal wording without evidence. |
| Did a job finish in time? | Per-run duration bars with configured budget line, success/fail/interrupted labels and due/grace markers. A missed run is a missing-run marker, never a zero-duration success. |
| Are errors recurring? | Daily occurrence bars and exact counts per issue/release over available count retention; first/last seen labels. Independently scaled mini-trends need counts to compare volume. Payload expiry must say “Sample expired”, not “No event occurred”. |
| Is backup recovery evidence recent? | A dated last-success/age row with configured interval and overdue boundary, per target/pebble; no gauge, pie chart or decorative health score. Never backed up is explicit and respects the initial grace. |

These charts adapt [Render's service metrics][render], [Datadog's error/latency graphs][dd-resource], [Cronitor's run model][cron] and [Bugsink's trends caveat][bugsink] to **Bedrock's actual retained data**, not those vendors' richer datasets. Metric precision, nulls, missing-map labels, privacy, retention and drop notices follow the [reference](../../reference.md#daemon-telemetry). In particular, show a coverage/drop warning near a chart when supplied; do not manufacture a continuous graph from lost batches.

### Typography, density and motion

- **Phone first:** start at 390×844 and check 320 CSS px/reflow. Use 16 px body, 14 px secondary metadata, 20–24 px section title, 28–32 px verdict; tabular numerals for timestamps/counts. Monospace belongs in logs, stack frames and copyable commands. Rows roughly 64–80 px with 12–16 px padding; full names may wrap to two lines, rather than relying on a title tooltip. These are design defaults, not requirements imposed by a vendor. [W3C reflow][a-reflow], [incident.io mobile examples][incident-status]
- **Density should reduce scanning, not font size.** One column on phone; desktop rows may expose extra metrics without making them obligatory on phone. Neutral surfaces, thin separators, restrained semantic accents; reserve the strongest fill for the active problem. No 25-card animated gauge grid. Put primary touch actions in ≥44×44 CSS px targets as a usability goal; WCAG 2.2 AA's minimum is 24×24 or qualifying spacing/exceptions, not 44×44. Tiny history bins need the equivalent larger interaction described above. [W3C target criterion][a-target], [Kuma density feedback][k-density]
- **Quiet updates:** no blinking outage, pulsing green hearts, chart sweep-in, card scaling, confetti or sound. At most a brief 100–150 ms opacity transition when an owner-initiated panel opens; disable with `prefers-reduced-motion`. Loading text/neutral skeleton is sufficient. Update meaningful status changes through a polite live region without moving focus; do not announce every probe or rerender a focused control. Automatic motion/refresh also needs pause/stop handling where applicable. [W3C interaction motion][a-motion], [automatic updates][a-pause], [status messages][a-status]

## 6. Verification boundaries and next design checks

Verified in this research: fetched official/public sources above; visually inspected pinned Gatus and official Kuma desktop screenshots; read Gatus card/detail and Kuma heartbeat source, plus Upptime status components in the existing research clones. The supplied clones matched the pinned UI content used here. Public pages are mutable snapshots; the report intentionally does not record their transient incident status as a product fact.

Not verified: authenticated commercial dashboards, current mobile touch/keyboard/screen-reader behavior, full colorblind/WCAG conformance of any vendor, actual push deep-link/auth restoration, public stale-page behavior with JS disabled, end-to-end Actions/ntfy/GitHub email delivery, or the proposed IA's performance/usability on this owner's phone. Gatus/Kuma demo URLs were inaccessible through the fetch tool; the Upptime demo fetch exposed its shell/range controls rather than populated live cards. Cachet's docs root returned 404, so its demo supports the narrow claims here. Direct Datadog service/resource-page fetches rejected their Markdown content type; chart claims use the search-indexed first-party resource-page text, not an exercised dashboard. The incident.io timeline FAQ redirected to a shell; its indexed first-party text supports only the narrow key-event claim. No evidence supports declaring one product universally best.

Acceptance work for M5, **not performed here**: open a push on a narrow phone → correct incident after login → inspect evidence → return to fleet; simulate home offline, stale outside journal, resumed suspended tab and disabled JS; include idle/hibernated/stopped/crash-loop/first-run cases; check keyboard, screen reader, grayscale, reflow and 200% zoom; measure current-summary and detail loading with 25 pebbles. Verify public HTML/JSON/feeds/accessibility labels contain no private identifiers. This is a design-validation checklist, not scope for app code in this research commit.

Repository verification for this documentation-only change:

- `bun install`: passed (114 packages installed); lockfile unchanged. `bun run typecheck`: passed.
- `TMPDIR=/dev/shm bun test`: **622 pass, 5 skip, 7 fail, 1 between-test error**, 634 tests / 414.13 s. The required full suite is **not green**. Two failures are the socket backpressure cases already recorded in WORKLOG; the other five are timeouts (React starter, two SDK upload cases, standalone React install, eight-day telemetry replay). The between-test error is a `PROCESS_FAILED` from `bun install` in the timed-out standalone React test; it is not claimed to be a separate regression.
- Required default-timeout `bun test -t "React starter"` rerun: still timed out (1 pass / 1 fail). Targeted `--timeout 90000` rerun of `React starter|SDK chooses chunking|SDK resumes by hashing|standalone react installs`: **5 pass / 0 fail** (includes the matching linked-starter test), 56.45 s. Eight-day telemetry replay with `--timeout 30000`: **1 pass / 0 fail**, 23.93 s. All runs used temporary test homes and `/dev/shm`; no test or timeout source was edited. The two recorded socket failures remain unresolved.
- `git diff --check`, local file/heading links, Markdown reference definitions and palette contrast calculation: passed. Upstream Gatus/Kuma clone HEADs matched the pinned revisions cited here. No claim of a full external-link, accessibility, browser or usability audit.

Only this report is committed; no WORKLOG edit, app code, runtime dependency, publication or push.

## Sources

Pinned UI sources use report 05's inspected revisions; SaaS documentation/public pages were fetched on the research date. First-hand feedback is linked separately and is not representative user research.

[g-license]: https://github.com/TwiN/gatus/blob/4b84fa2d591a364325b17d81ade755523508dc0b/LICENSE
[g-screen]: https://github.com/TwiN/gatus/blob/4b84fa2d591a364325b17d81ade755523508dc0b/.github/assets/dashboard-dark.jpg
[g-card]: https://github.com/TwiN/gatus/blob/4b84fa2d591a364325b17d81ade755523508dc0b/web/app/src/components/EndpointCard.vue
[g-detail]: https://github.com/TwiN/gatus/blob/4b84fa2d591a364325b17d81ade755523508dc0b/web/app/src/views/EndpointDetails.vue
[k-screen]: https://user-images.githubusercontent.com/1336778/212262296-e6205815-ad62-488c-83ec-a5b0d0689f7c.jpg
[k-bars]: https://github.com/louislam/uptime-kuma/blob/df601c58d9205562f34cfe5ef35264b341019d19/src/components/HeartbeatBar.vue
[k-page]: https://github.com/louislam/uptime-kuma/blob/df601c58d9205562f34cfe5ef35264b341019d19/src/pages/StatusPage.vue
[atlassian-uptime]: https://support.atlassian.com/statuspage/docs/display-historical-uptime-of-components/
[incident-status]: https://incident.io/status-pages
[incident-timeline]: https://help.incident.io/articles/5456697918-can-we-edit-the-timeline
[better-status]: https://status.betterstack.com/
[better-uptime]: https://betterstack.com/uptime
[instatus-components]: https://instatus.com/help/status-page/components
[instatus-main]: https://instatus.com/help/status-page/main-status
[instatus-example]: https://site.instatus.com/history/1
[openstatus-live]: https://status.openstatus.dev/
[openstatus-ref]: https://www.openstatus.dev/docs/reference/status-page
[upptime]: https://upptime.js.org/docs/
[upptime-demo]: https://demo.upptime.js.org/
[cachet]: https://demo.cachethq.io/
[github-status]: https://www.githubstatus.com/
[cloudflare-status]: https://www.cloudflarestatus.com/
[vercel-status]: https://www.vercel-status.com/
[linear-status]: https://linearstatus.com/
[hc]: https://healthchecks.io/docs/
[hc-config]: https://healthchecks.io/docs/configuring_checks/
[cron]: https://cronitor.io/docs/cron-job-monitoring
[pd]: https://docs.pagerduty.com/incident-management/incidents/overview
[pd-mobile]: https://docs.pagerduty.com/get-started/mobile-app
[rootly-timeline]: https://rootly.com/changelog/catch-up-on-any-incident-in-seconds-with-ai-timelines
[sentry-priority]: https://sentry.io/changelog/issue-priority-ga/
[sentry-feedback]: https://sentry.io/changelog/2023-7-14-new-priority-sort-for-issues/
[bugsink]: https://www.bugsink.com/docs/triage/
[bugsink-alerts]: https://www.bugsink.com/docs/alerts/
[grafana-drill]: https://grafana.com/docs/grafana/latest/visualizations/simplified-exploration/
[grafana-nodata]: https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/nodata-and-error-states/
[dd-resource]: https://docs.datadoghq.com/tracing/services/resource_page/
[vercel-obs]: https://vercel.com/docs/observability
[railway-layout]: https://railway.com/changelog/2026-03-20-new-dashboard-layout
[railway-metrics]: https://docs.railway.com/observability/metrics
[fly-design]: https://community.fly.io/t/feature-improved-app-page/5213
[render]: https://render.com/docs/service-metrics
[coolify]: https://coolify.io/docs/core/observability/monitoring/overview
[k-feedback]: https://www.reddit.com/r/selfhosted/comments/oi7dc7/uptime_kuma_a_fancy_selfhosted_monitoring_tool_an/
[k-density]: https://github.com/louislam/uptime-kuma/issues/6181
[gh-schedule]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
[a-color]: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
[a-contrast]: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
[a-nontext]: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
[a-target]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
[a-status]: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
[a-motion]: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
[a-pause]: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
[a-reflow]: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
