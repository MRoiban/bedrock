import { join } from "node:path";
import { asBedrockError, BedrockError } from "../../error";
import { readConfig } from "../config";
import { AlertStore } from "./store";
import { AlertEvaluator } from "./evaluator";
import { deliver } from "./delivery";
declare const self: Worker;
let evaluator: AlertEvaluator | undefined, home = "", webhook: string | undefined;
let proxyPort: number | undefined;
let timer: ReturnType<typeof setInterval> | undefined, busy = false;
async function delivery() {
  if (!evaluator || busy) return;
  busy = true;
  try { await deliver(evaluator, home, webhook, fetch, proxyPort); }
  catch { console.error("Alert outbox unavailable; inspect bedrock alerts and free disk space."); }
  finally { busy = false; }
}
let testClock = false, now = 0;
const handle = async ({ data }: MessageEvent) => {
  if (data.now !== undefined) now = data.now;
  try {
    if (data.op === "init") {
      home = data.home;
      proxyPort = data.proxyPort;
      const config = data.config ?? await readConfig(home);
      testClock = data.testClock === true;
      evaluator = new AlertEvaluator(new AlertStore(join(home, "alerts.sqlite"), config.domain, () => testClock ? now : Date.now()), config.alerts?.criticalJobs);
      webhook = config.alerts?.webhook;
      evaluator.store.prune();
      for (const row of evaluator.store.db.query<{ pebble: string }, []>("SELECT DISTINCT pebble FROM runs WHERE state='started'").all()) evaluator.jobs.interrupt(row.pebble);
      if (!testClock) { timer = setInterval(() => void delivery(), 1000); timer.unref(); }
    } else {
      if (!evaluator) throw new BedrockError("ALERTS_UNAVAILABLE", "Alert store is unavailable.", "Restart the daemon and inspect its logs.");
      let value: unknown;
      if (data.op === "proxy") proxyPort = data.port;
      else if (data.op === "dispatchForTests" && testClock) await delivery();
      else if (data.op === "snapshot") evaluator.evaluate(data.snapshot);
      else if (data.op === "job") evaluator.jobs.event(data.pebble, data.event);
      else if (data.op === "exit") evaluator.jobs.interrupt(data.pebble);
      else if (data.op === "view") value = evaluator.store.view();
      else if (data.op === "history") value = evaluator.store.history(data.pebble);
      else if (data.op === "silence") value = evaluator.store.silence(data.fingerprint, data.until);
      else if (data.op === "test") {
        if (!webhook) throw new BedrockError("ALERTS_NOT_CONFIGURED", "No alert webhook configured.", "Run bedrock alerts setup on the daemon host and restart the daemon.");
        value = { id: evaluator.store.enqueue(null, "test", "Bedrock alert delivery test. Run bedrock alerts --json to inspect webhook acceptance."), queued: true };
      } else if (data.op === "close") {
        clearInterval(timer);
        // Pending delivery has a short network deadline; the parent terminates this Worker after the reply.
        if (busy) throw new BedrockError("ALERTS_BUSY", "Webhook delivery is finishing.", "Pending rows survive shutdown.");
        evaluator.store.close();
      }
      self.postMessage({ id: data.id, value });
    }
  } catch (error) { self.postMessage({ id: data.id, error: asBedrockError(error, "ALERTS_UNAVAILABLE", "Inspect daemon logs, alerts.sqlite permissions and disk space.").toJSON() }); }
};

let work = Promise.resolve();
self.onmessage = event => { work = work.then(() => handle(event)); };
