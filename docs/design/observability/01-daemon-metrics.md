# Daemon/proxy observability

## 1. Recommendation

Research checked 2026-11-07. Numbers below are proposed defaults, not measured Bedrock capacity. Grounding: read ARCHITECTURE, reference §§8/10/11/13/14 and author-guide logs/dev/jobs sections at checkout `fe936756e137fe85fa35821d9ae9a376e25bcbcc`; inspected [proxy](https://github.com/MRoiban/bedrock/blob/fe936756e137fe85fa35821d9ae9a376e25bcbcc/packages/bedrock/src/daemon/proxy.ts), supervisor, logs and cgroups. Existing logs rotate at 10 MiB × four files; request completion follows response-body consumption/cancellation. Preserve secret redaction and lifecycle semantics.

- **One daemon-owned `observability.sqlite`**, outside identity and pebble databases; no scraper, sidecar or SaaS. Keep it under the configured data root; extend data-move handling. [Sentinel already demonstrates SQLite collection and traffic rollups](https://github.com/coollabsio/sentinel/blob/main/README.md#architecture).
- **RED plus saturation:** unsampled request starts/completions, status classes, 5xx, proxy failures, client aborts, in-flight HTTP and open WebSockets; latency distributions; host disk/memory pressure and process CPU/memory. Separate control/health traffic. [RED](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/), [golden signals](https://sre.google/sre-book/monitoring-distributed-systems/), [USE](https://www.brendangregg.com/usemethod.html).
- Measure monotonic **headers-ready latency** and **proxy-stream lifetime** separately, including cold wake time. The existing body wrapper measures consumption, not confirmed last-byte delivery to the browser; label accordingly. Record cancellation/body-read failure even after 200 headers. WebSocket handshake counts once; connection lifetime has separate counters. [Envoy distinguishes timing phases and failure flags](https://www.envoyproxy.io/docs/envoy/latest/api-v3/data/accesslog/v3/accesslog.proto).
- Persist exact totals independent of diagnostic sampling. Define failure ratio as `failed_completed / completed`: 5xx or transport/body failure, counted once; exclude client aborts, report 4xx/429 separately. Show starts/s and completions/s explicitly. Successful and failed latency histograms stay separate; [SRE warns that fast failures can distort latency](https://sre.google/sre-book/monitoring-distributed-systems/).
- Adopt OTel names at API/export boundaries: `http.request.method`, `http.response.status_code`, `url.scheme`, `network.protocol.version`, bounded `error.type`, optional true `http.route`. Map unfamiliar methods to `_OTHER`; never substitute raw paths for routes. Obtain trusted route templates through runtime IPC metadata later; initially aggregate per pebble and four traffic classes: ordinary, stream, WebSocket, control. [HTTP conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/).
- **Histogram v1:** noncumulative bucket counts using OTel seconds boundaries `.005,.01,.025,.05,.075,.1,.25,.5,.75,1,2.5,5,7.5,10`, plus overflow; version the BLOB format. Merge counts/sums/maxima, never percentiles. Return p50/p95/p99 as bucket intervals, overflow as `>10s`, and sample count. Use identical arrays for headers/stream duration, success/failure. [OTel](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/).
- If actual investigations need tighter quantiles, replace histogram payloads with **DDSketch at 1% relative accuracy**, explicitly bounded bins and documented collapse behavior; do not promise accuracy outside the retained range. HdrHistogram is an alternative with configured maximum and significant digits. Neither library is necessary for initial coarse intervals. [DDSketch paper](https://www.vldb.org/pvldb/vol12/p2195-masson.pdf), [HdrHistogram](https://github.com/HdrHistogram/HdrHistogram).
- Sample live resources every **15 seconds**, never wake idle pebbles. Reuse existing Linux cgroups: `memory.current`/swap, `cpu.stat` deltas and `memory.events` OOM deltas where available; retain source labels because cgroup memory includes more than RSS. CPU 100% means one core. Sample both children during deploy overlap and sum for pebble totals. Unsupported platforms return null/capability metadata; Bun [`resourceUsage()` is exit-only](https://bun.sh/reference/bun/Subprocess/resourceUsage), [kernel counters](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html).
- Store lifecycle events immediately: spawn, ready, activation, exit, crash, retry, idle, manual stop, deploy retirement; include run/release, exit code/signal, reason, retry time. SIGKILL alone does not prove OOM. Integrate state durations, but mark daemon-offline intervals unknown; report process uptime separately from request success. [Fly exit metrics](https://docs.fly.io/monitoring/metrics#instance-exit-fly_instance_exit_), [Bedrock lifecycle](https://github.com/MRoiban/bedrock/blob/fe936756e137fe85fa35821d9ae9a376e25bcbcc/docs/reference.md).
- **Retention:** resources 15s/24h; HTTP and resource rollups 1m/7d, 1h/90d, 1d/365d; lifecycle events/90d; diagnostic requests/24h; logs/7d. Time and byte budgets both apply, oldest first. Minute/hour/day boundaries use UTC. Build parents atomically before deleting children; recompute closed buckets idempotently. [Netdata tiering](https://learn.netdata.cloud/docs/netdata-agent/database).
- Proposed schema below: integer epoch milliseconds, duration microseconds internally; rollup rows are interval deltas. Gauge rollups preserve time-weighted integral, covered duration, maximum and last value; CPU preserves consumed CPU microseconds and wall duration. Counter reset/run changes establish new baselines. [VictoriaMetrics explains series/churn costs](https://docs.victoriametrics.com/victoriametrics/faq/).
- Put redacted stdout/stderr into `log`, preserving stream/run/release; stderr alone is not severity=error. Index text with external-content FTS5 and transactional insert/delete triggers; index `(pebble,t_ms,id)`, `(pebble,level,t_ms)` and request ID. Cap messages at 16 KiB; count truncations. Make SQLite authoritative after migration, avoid permanent double storage. [FTS5 external-content consistency](https://www.sqlite.org/fts5.html#external_content_tables).
- Diagnostic access events: retain failures and >1s requests subject to caps, plus deterministic **1% successes**. Per-pebble token buckets: logs 50 lines/s, 128 KiB/s; request events 10/s; bursts twice those amounts. Always increment drop counters and aggregate HTTP counts. No request/response bodies, cookies, auth, query strings, IP, email or user-agent; only known route templates and generated request IDs. [Railway explicitly reports dropped logs](https://docs.railway.com/observability/logs), [Caddy redacts sensitive headers](https://caddyserver.com/docs/caddyfile/directives/log).
- Budget **512 MiB DB+indexes**, reserve **64 MiB WAL**, 8 MiB SQLite cache and 4 MiB ingestion queue. Partition logical budgets: 256 MiB logs, 64 MiB request events, 160 MiB metrics, 32 MiB lifecycle. Batch every second/256 records in a daemon-owned Worker; flush shutdown, accept ≤1s crash loss with explicit coverage gaps. Prioritize metrics/lifecycle over text; storage failure never blocks HTTP. Track writer lag, dropped data, WAL bytes and free disk. These budgets require workload measurement, not a claimed memory ceiling.
- SQLite: WAL/NORMAL, one writer, short paginated reads; finish each read before streaming results. Reuse Bedrock's safe-build/checkpoint-worker guards. Delete ≤1,000 rows/transaction; incremental vacuum only on an INCREMENTAL database, bounded maintenance, no daily full VACUUM. Pause ingestion at disk reserve/WAL backstop, report degraded status. [WAL starvation](https://www.sqlite.org/wal.html#avoiding_excessively_large_wal_files), [vacuum pragmas](https://www.sqlite.org/pragma.html#pragma_incremental_vacuum).
- Add creator-authorized `GET /api/pebbles/:name/metrics?from=&to=&step=`, `/events`, and `/logs?q=&cursor=&limit=`; reuse scoped `status` permission for metrics and `logs` for detail. Enforce 1,000 output rows, bounded ranges, parameterized filters and opaque cursors. `--json` emits one normal Bedrock envelope, including units, resolution, sample counts, coverage and drops. Defaults: `bedrock status` latest resources + 5m RED; `bedrock metrics notes --since 1h --step 1m`; `bedrock errors notes --since 24h`; `bedrock logs notes --search 'timeout' --since 1h`. [Existing API contract](https://github.com/MRoiban/bedrock/blob/fe936756e137fe85fa35821d9ae9a376e25bcbcc/docs/reference.md).

Concrete schema sketch (abbreviated column families, expanded by migration):

```sql
http_rollup(step_s,t_ms,pebble,traffic,
  started,completed,failed,aborted,s1xx,s2xx,s3xx,s4xx,s5xx,
  headers_ok_hist,headers_fail_hist,body_ok_hist,body_fail_hist,
  headers_sum_us,body_sum_us,max_us,inflight_peak,coverage_ms,
  PRIMARY KEY(step_s,t_ms,pebble,traffic)) WITHOUT ROWID;
resource_rollup(step_s,t_ms,pebble,source,
  cpu_us,covered_us,memory_byte_us,memory_max_bytes,memory_last_bytes,
  swap_max_bytes,ws_peak,disk_bytes,oom_kills,
  PRIMARY KEY(step_s,t_ms,pebble,source)) WITHOUT ROWID;
event(id INTEGER PRIMARY KEY,t_ms,pebble,run_id,release,kind,
  reason,exit_code,signal,next_retry_ms,details_json);
request_event(id INTEGER PRIMARY KEY,t_ms,pebble,run_id,release,
  request_id,method,route_template,status,error_type,
  headers_us,body_us,outcome,sample_probability);
log(id INTEGER PRIMARY KEY,t_ms,pebble,run_id,release,stream,
  level,request_id,message);
CREATE VIRTUAL TABLE log_fts USING fts5(message,content='log',content_rowid='id');
```

Illustrative text output (p95 is a bucket bound, not an exact quantile):

```text
PEBBLE STATE   REQ/S  FAIL/COMPLETED  P95 HEADERS   CPU/CORE MEM       CRASHES/24H
notes  running 0.42   2/126 (1.59%)   (75,100]ms    3.2%     84MiB(cg) 1
Coverage 300/300s; events sampled; logs dropped 12; local origin only
```

## 2. Sources studied

- **Coolify / Sentinel:** [architecture](https://github.com/coollabsio/sentinel/blob/main/README.md#architecture) collects host/container stats into SQLite with cleanup and optional proxy-log rollups. Copy local aggregation; avoid another daemon/container when Bedrock already owns ingress and children.
- **Dokku:** [log management](https://dokku.com/docs/deployment/logs/) offers app-tail commands, Docker rotation and optional Vector sinks. Copy app-scoped commands; its file sinks require operator-managed rotation—an unsafe default for unattended Bedrock.
- **CapRover:** [monitoring](https://caprover.com/docs/resource-monitoring.html) integrates optional Netdata. Copy instant resource visibility; a separate broad monitoring system exceeds this task's dependency budget.
- **Kamal:** [app commands](https://kamal-deploy.org/docs/commands/app/) expose logs, container details and lifecycle operations. Copy direct operational verbs; these commands alone do not supply historical latency or failure distributions.
- **Dokploy:** [monitoring](https://docs.dokploy.com/docs/core/monitoring) documents 20s sampling, two-day retention and host threshold alerts. Copy explicit collection/retention defaults; avoid requiring a reachable metrics port and treating host alerts as per-app diagnosis.
- **Fly.io:** [built-in metrics](https://docs.fly.io/monitoring/metrics) include response counts/histograms, concurrency and instance exits. Copy proxy/process correlation; separate connection time from request time and local monitoring from end-to-end availability.
- **Railway:** [metrics](https://docs.railway.com/observability/metrics) preserve deployment continuity but explicitly omit application latency/error metrics; [logs](https://docs.railway.com/observability/logs) have limits/drop notices. Copy release correlation and transparent loss; resource graphs alone are insufficient.
- **Render:** [service metrics](https://render.com/docs/service-metrics) combine resources, HTTP statuses and latency percentiles. Copy unified diagnosis; documented HTTP metrics cover public traffic only, illustrating why scope must be explicit.
- **Vercel:** [observability](https://vercel.com/docs/observability) connects route errors/duration to logs and distinguishes multiple event types per request. Copy drill-through; do not count internal events as independent user requests.
- **Netlify:** [overview](https://docs.netlify.com/manage/monitoring/observability/overview/) explicitly distinguishes server requests from visitors/pageviews and excludes traffic stopped upstream. Copy that explanation; Bedrock cannot observe Cloudflare-cached/blocked traffic or tunnel outages from proxy counters.
- **Caddy:** [metrics](https://caddyserver.com/docs/metrics) and [implementation](https://github.com/caddyserver/caddy/blob/master/modules/caddyhttp/metrics.go) provide HTTP histograms and configured-host cardinality protection. Copy bounded identities; arbitrary Host labels can consume unbounded memory.
- **Traefik:** [access logs](https://doc.traefik.io/traefik/reference/install-configuration/observability/logs-and-accesslogs/) separate origin/downstream status and duration, support filters and field redaction. Copy failure provenance; a single status/duration obscures proxy behavior.
- **Envoy:** [typed logging](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage) and [fields](https://www.envoyproxy.io/docs/envoy/latest/api-v3/data/accesslog/v3/accesslog.proto) distinguish timing phases, reset flags and missing values. Copy typed nulls/flags; avoid wholesale field collection and protocol complexity.
- **Prometheus TSDB:** [storage](https://prometheus.io/docs/prometheus/latest/storage/) uses a mutable WAL-backed head, two-hour blocks and compaction. Copy bounded intervals and retention; its storage/WAL design is unnecessary infrastructure here, and deletion is not immediate physical reclamation.
- **VictoriaMetrics:** [FAQ](https://docs.victoriametrics.com/victoriametrics/faq/) explains single-node operation and cardinality/churn cache pressure. Copy cardinality discipline; adding a separate TSDB contradicts SQLite-only ownership.
- **Netdata:** [database tiers](https://learn.netdata.cloud/docs/netdata-agent/database) retain progressively coarser data with both size/time limits. Copy rollups; its documentation explicitly warns soft size limits overshoot and require headroom.
- **OpenObserve:** [architecture](https://openobserve.ai/docs/architecture/) uses SQLite metadata alongside WAL/memtables and Parquet data. Copy ingestion/query separation; “uses SQLite” does not mean SQLite-only telemetry. [Memory discussion #2682](https://github.com/openobserve/openobserve/discussions/2682) documents historical buffering costs, not a current benchmark.
- **Loki:** [cardinality guidance](https://grafana.com/docs/loki/latest/get-started/labels/cardinality/) favors low-cardinality labels and structured metadata. Copy pebble/time-first filtering; avoid request IDs and variable paths as stream labels.
- **OTel HTTP:** [conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/) standardize duration and bounded attributes. Copy names/units; route templates must come from routing metadata rather than guessed URLs.
- **Methods:** [Google SRE](https://sre.google/sre-book/monitoring-distributed-systems/), [RED](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/), [USE](https://www.brendangregg.com/usemethod.html) complement service outcomes with resource bottlenecks. Avoid dashboards dominated by averages or CPU without user-visible failures.
- **Latency algorithms:** [HdrHistogram](https://github.com/HdrHistogram/HdrHistogram) gives fixed precision/range and optional coordinated-omission correction; [DDSketch](https://www.vldb.org/pvldb/vol12/p2195-masson.pdf) provides mergeable relative-error quantiles. Copy mergeability; never average p99s or fabricate production arrivals through load-test correction.
- **SQLite:** [WAL](https://www.sqlite.org/wal.html), [FTS5](https://www.sqlite.org/fts5.html), [pragmas](https://www.sqlite.org/pragma.html) cover readers/checkpoints, external indexes and incremental reclamation. Copy bounded transactions; neither DELETE nor a configured retention period guarantees a smaller file.

## 3. Anti-patterns

- **Unbounded dimensions:** Caddy's [host protections](https://github.com/caddyserver/caddy/blob/master/modules/caddyhttp/metrics.go) and Loki's [cardinality warnings](https://grafana.com/docs/loki/latest/get-started/labels/cardinality/) address a concrete memory/index failure mode. Never label by URL, user or request ID.
- **Retention without disk admission:** [Netdata documents overshoot](https://learn.netdata.cloud/docs/netdata-agent/database); [Dokku file sinks lack automatic rotation](https://dokku.com/docs/deployment/logs/). Enforce queue/byte limits before writes and expose reduced coverage.
- **“Lightweight” without buffering budgets:** [OpenObserve discussion](https://github.com/openobserve/openobserve/discussions/2682) shows surprising memory growth; its [current architecture](https://openobserve.ai/docs/architecture/) still separates buffering from durable storage. Benchmark noisy pebbles and simultaneous log searches.
- **Monitoring creates downtime:** [SQLite reader starvation](https://www.sqlite.org/wal.html#avoiding_excessively_large_wal_files) can grow WAL indefinitely. Never hold a transaction while a slow CLI follows logs; never make telemetry persistence part of proxy success.

## 4. Open questions

1. Is 512 MiB telemetry storage acceptable, and should operators configure one budget rather than individual retention knobs?
2. Are coarse percentile bounds sufficient initially, or is a vetted Bun-compatible DDSketch implementation justified immediately?
3. Must live per-process metrics ship equally on macOS/Windows, or can initial capabilities be Linux-first with explicit nulls elsewhere?
4. Should searchable SQLite logs replace rotated files immediately or follow a short, explicitly bounded migration period?
5. Should availability cover only local origin behavior, or should a separate pebble probe the public tunnel? A daemon on a dead host cannot report its own outage.
