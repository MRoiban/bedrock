import { hostTarget } from "../proxy";
import { join } from "node:path";
import { isQuiet, type Incident } from "./model";
import type { AlertEvaluator } from "./evaluator";
export async function deliver(evaluator: AlertEvaluator, home: string, webhook: string | undefined, fetcher: typeof fetch = fetch, proxyPort?: number) {
  if (!webhook) return;
  const store = evaluator.store, db = store.db;
  store.prune();
  const url = new URL(webhook), target = hostTarget(url.host, store.host);
  const local = proxyPort && url.hostname.endsWith(`.${store.host}`) && target && !["auth", "bedrock"].includes(target);
  const destination = local ? `http://127.0.0.1:${proxyPort}${url.pathname}` : webhook;
  const secret = (await Bun.file(join(home, "alerts-secret")).text().catch(() => "")).trim();
  let attempts = 0;
  for (const row of store.pending()) {
    const incident = row.incident ? db.query<Incident, [string]>("SELECT * FROM incidents WHERE id=?").get(row.incident) : null;
    if (incident) {
      if (incident.resolved !== null && incident.notified === null && db.query("SELECT 1 FROM outbox WHERE incident=? AND error IN ('INHIBITED','SILENCED')").get(incident.id)) {
        db.query("UPDATE outbox SET state='suppressed' WHERE incident=?").run(incident.id); continue;
      }
      if (evaluator.inhibited(incident) || store.silenced(incident.fingerprint)) {
        db.query("UPDATE outbox SET error=? WHERE id=?").run(evaluator.inhibited(incident) ? "INHIBITED" : "SILENCED", row.id);
        if (incident.resolved !== null && incident.notified === null) db.query("UPDATE outbox SET state='suppressed' WHERE incident=?").run(incident.id);
        continue;
      }
      if (incident.resolved !== null && row.transition !== "resolved" && row.transition !== "opened") { db.query("UPDATE outbox SET state='suppressed' WHERE id=?").run(row.id); continue; }
    }
    if (row.transition !== "digest" && !incident?.page && isQuiet(store.clock())) continue;
    // A later transition cannot overtake an earlier retry, even after reopening the store.
    if (incident && db.query("SELECT 1 FROM outbox WHERE incident=? AND state='pending' AND rowid<(SELECT rowid FROM outbox WHERE id=?) LIMIT 1").get(incident.id, row.id)) continue;
    if (attempts++ >= 16) break;
    let status = "WEBHOOK_SECRET_MISSING", retry = 0;
    if (secret) try {
      const response = await fetcher(destination, { method: "POST", redirect: "error", signal: AbortSignal.timeout(2000), headers: { ...(local ? { host: url.host } : {}), authorization: `Bearer ${secret}`, "content-type": "application/json", "idempotency-key": row.id }, body: row.payload });
      status = `HTTP_${response.status}`;
      retry = Number(response.headers.get("retry-after")) * 1000;
      // Acceptance is the webhook contract; downstream provider delivery belongs to the receiver.
      await response.body?.cancel();
      if (response.ok) {
        db.transaction(() => {
          db.query("UPDATE outbox SET state='accepted',attempts=attempts+1,error=NULL WHERE id=?").run(row.id);
          if (incident && row.transition === "opened") db.query("UPDATE incidents SET notified=? WHERE id=?").run(store.clock(), incident.id);
        })();
        continue;
      }
    } catch { status = "WEBHOOK_UNREACHABLE"; }
    const delay = Math.max(Number.isFinite(retry) ? Math.min(retry, 21600000) : 0, Math.min(21600000, 1000 * 2 ** Math.min(row.attempts, 15)));
    db.query("UPDATE outbox SET attempts=attempts+1,error=?,due=? WHERE id=?").run(status, store.clock() + delay, row.id);
  }
  evaluator.deliveryBroken();
}
