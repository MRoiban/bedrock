// Clock-driven storage replay, not a real-time soak. Never uses the real Bedrock home.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelemetryStore } from "../src/daemon/telemetry/store";
import { emptyRed, type Record } from "../src/daemon/telemetry/model";

export function replay(days: number, requestsPerMinute: number, resourcePebbles = 24, logsEveryMinutes = 1) {
  const root = mkdtempSync(join(tmpdir(), "telemetry-retention-")), path = join(root, "observability.sqlite");
  const store = new TelemetryStore(path);
  const start = Date.UTC(2026, 0, 1), end = start + days * 86400000;
  let dropped = 0;
  try {
    for (let minute = 0; minute < days * 1440; minute++) {
      const time = start + minute * 60000, records: Record[] = [];
      for (let p = 0; p < 24; p++) {
        const pebble = `p${p}`, value = { ...emptyRed(), starts: requestsPerMinute, completions: requestsPerMinute, gauge_at: time, headers_sum_s: .005 * requestsPerMinute, lifetime_sum_s: .006 * requestsPerMinute, headers_max_s: .005, lifetime_max_s: .006 };
        value.headers_success[0] = requestsPerMinute; value.lifetime_success[1] = requestsPerMinute;
        if (requestsPerMinute === 60 && minute >= days * 1440 - 5) {
          for (let second = 0; second < 60; second++) records.push({ kind: "metrics", pebble, time: time + second * 1000, traffic: "ordinary", value: { ...value, starts: 1, completions: 1, headers_sum_s: .005, lifetime_sum_s: .006, gauge_at: time + second * 1000, headers_success: [1, ...Array(14).fill(0)], lifetime_success: [0, 1, ...Array(13).fill(0)] } });
        } else records.push({ kind: "metrics", pebble, time, traffic: "ordinary", value });
        if (minute % logsEveryMinutes === 0) records.push({ kind: "logs", pebble, time, stream: "stdout", run: "run", boot: "replay", sequence: minute * 24 + p, text: "A normal application log entry " + "x".repeat(150) });
        if ((minute * 24 + p) % 100 < requestsPerMinute) records.push({ kind: "events", pebble, time, route: "/:segment", method: "GET", status: 200, outcome: "success", headers_s: .005, lifetime_s: .006 });
        for (let sample = 0; sample < 4; sample++) records.push({ kind: "resources", pebble, time: time + sample * 15000, value: { resident: p < resourcePebbles ? 20000000 : null, swap: p < resourcePebbles ? 0 : null, cpu_us: p < resourcePebbles ? 100000 : null, oom_kills: p < resourcePebbles ? 0 : null, source: p < resourcePebbles ? "cgroup" : null, interval_ms: 15000, cpu_percent: p < resourcePebbles ? 100 / 150 : null } });
      }
      while (records.length) dropped += store.write(records.splice(0, 256), time + 59000).length;
    }
    dropped += store.write([], end).length;
    return {
      days, pebbles: 24, requests_per_minute: requestsPerMinute, resource_pebbles: resourcePebbles, logs_every_minutes: logsEveryMinutes,
      // The original M1 growth replay used minute aggregates, not 86,400 seconds of input.
      second_tier: requestsPerMinute === 60 ? "minute aggregates; final 5 minutes replayed at 1 second" : "one request/minute",
      bytes: statSync(path).size, wal_bytes: statSync(path + "-wal").size, dropped,
      history: store.db.query(`SELECT kind,step,count(*) AS rows,min(time) AS oldest_ms,max(time) AS newest_ms,round((?-min(time))/86400000.0,6) AS retained_days FROM records GROUP BY kind,step ORDER BY kind,step`).all(end),
      tiers: store.db.query("SELECT * FROM metric_tiers ORDER BY step").all(),
      evictions: store.db.query("SELECT reason,sum(count) AS count FROM losses GROUP BY reason").all(),
      status_pebbles: store.db.query("SELECT count(DISTINCT pebble) AS count FROM records WHERE kind='metrics' AND step=1 AND time>=?").get(end - 300000),
      status_rows_per_pebble: store.db.query("SELECT min(rows) AS min,max(rows) AS max FROM (SELECT count(*) AS rows FROM records WHERE kind='metrics' AND step=1 GROUP BY pebble)").get(),
      status_p0_completions: store.query({ kind: "metrics", pebble: "p0", from: end - 300000, to: end, step: 1, limit: 1000 }).rows.reduce((sum, row) => sum + row.completions, 0),
      integrity: store.db.query("PRAGMA integrity_check").get(),
    };
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
}
if (import.meta.main) {
  const mode = process.argv[2] ?? "low";
  console.log(JSON.stringify(replay(mode === "original" ? 1 : 8, mode.startsWith("low") ? 1 : 60, mode.startsWith("low") ? 20 : 24, mode === "low" ? 10 : 1), null, 2));
}
