import { BedrockError } from "../error";
import { disconnected } from "./wire";

interface Pending {
  message: { op: "mut"; id: string; mutation: string; args: unknown; idempotencyKey: string };
  sent: boolean;
  failures: number;
  cancelTimeout: () => void;
  resolve: (value: any) => void;
  reject: (error: BedrockError) => void;
}

export function pendingMutations(hooks: { settled: () => void; checkRelease: () => void }) {
  const pending = new Map<string, Pending>();
  function failed(id: string, item: Pending, error: BedrockError) {
    if (++item.failures < 3) { item.sent = false; return true; }
    pending.delete(id); item.reject(error); hooks.settled();
    return false;
  }
  function enqueue(id: string, mutation: string, args: unknown, idempotencyKey: string, start: () => void) {
    return new Promise<any>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      const item: Pending = {
        message: { op: "mut", id, mutation, args, idempotencyKey }, sent: false, failures: 0,
        cancelTimeout: () => clearTimeout(timeout),
        resolve(value) { clearTimeout(timeout); resolve(value); hooks.checkRelease(); },
        reject(error) { clearTimeout(timeout); reject(error); hooks.checkRelease(); },
      };
      function timedOut() {
        const error = new BedrockError("MUTATION_TIMEOUT", "No mutation result arrived after 3 attempts.", "The client retried with the same idempotency key. Check the server; a new call uses a new key, so check whether the mutation committed before calling again.");
        if (!failed(id, item, error)) return;
        timeout = setTimeout(timedOut, 30_000);
        start();
      }
      pending.set(id, item);
      timeout = setTimeout(timedOut, 30_000);
      start();
    });
  }
  function flush(send: (message: object) => void) {
    for (const item of pending.values()) {
      if (!item.sent) { send(item.message); item.sent = true; }
    }
  }
  function rejectSent() {
    for (const [id, item] of pending) {
      if (item.sent) failed(id, item, disconnected());
    }
    hooks.checkRelease();
  }
  function fallback(mutate: (name: string, args: unknown, idempotencyKey: string) => Promise<any>) {
    for (const [id, item] of pending) {
      if (item.sent) continue;
      pending.delete(id); item.cancelTimeout();
      void mutate(item.message.mutation, item.message.args, item.message.idempotencyKey).then(item.resolve, item.reject);
    }
  }
  function complete(id: string, ok: boolean, value: unknown, error: BedrockError) {
    const item = pending.get(id);
    if (!item) return false;
    pending.delete(id);
    if (ok) item.resolve(value); else item.reject(error);
    return true;
  }
  function close() {
    for (const item of pending.values()) item.reject(disconnected());
    pending.clear();
  }
  return { size: () => pending.size, enqueue, flush, rejectSent, fallback, complete, close };
}
