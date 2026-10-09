import { remoteError } from "./wire";
import type { pendingMutations } from "./pending";
import type { subscriptionStore } from "./subscriptions";

export function socketProtocol(
  subscriptions: ReturnType<typeof subscriptionStore>,
  pending: ReturnType<typeof pendingMutations>,
  observe: (release: unknown) => void,
  settled: () => void,
) {
  function opened(send: (message: object) => void) {
    for (const [id, sub] of subscriptions.entries) send({ op: "sub", id, query: sub.query, args: sub.args ?? null });
    pending.flush(send);
  }
  function message(data: unknown, ws: WebSocket) {
    let message: any;
    try { message = JSON.parse(String(data)); }
    catch { ws.close(1002, "Invalid server message"); return; }
    if (message.op === "hello") observe(message.release);
    else if (message.op === "data") subscriptions.socketData(message.id, message.result);
    else if (message.op === "result") {
      if (!pending.complete(message.id, message.ok, message.value, remoteError(message.error))) return;
    } else if (message.op === "error") {
      pending.complete(message.id, false, undefined, remoteError(message.error));
      subscriptions.entries.get(message.id)?.onError?.(remoteError(message.error));
    }
    settled();
  }
  return { opened, message };
}
