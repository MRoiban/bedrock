import { BedrockError } from "../error";
import { disconnected } from "./wire";

interface Pending {
  message: { op: "mut"; id: string; mutation: string; args: unknown };
  sent: boolean;
  cancelTimeout: () => void;
  resolve: (value: any) => void;
  reject: (error: BedrockError) => void;
}

export function pendingMutations(hooks: { settled: () => void; checkRelease: () => void }) {
  const pending = new Map<string, Pending>();
  function enqueue(id: string, mutation: string, args: unknown, start: () => void) {
    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new BedrockError("MUTATION_TIMEOUT", "No mutation result arrived within 30 seconds.", "Check whether the mutation committed before retrying."));
        hooks.settled(); hooks.checkRelease();
      }, 30_000);
      pending.set(id, {
        message: { op: "mut", id, mutation, args }, sent: false,
        cancelTimeout: () => clearTimeout(timeout),
        resolve(value) { clearTimeout(timeout); resolve(value); hooks.checkRelease(); },
        reject(error) { clearTimeout(timeout); reject(error); hooks.checkRelease(); },
      });
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
      if (item.sent) { pending.delete(id); item.reject(disconnected()); }
    }
    hooks.checkRelease();
  }
  function fallback(mutate: (name: string, args: unknown) => Promise<any>) {
    for (const [id, item] of pending) {
      if (item.sent) continue;
      pending.delete(id); item.cancelTimeout();
      void mutate(item.message.mutation, item.message.args).then(item.resolve, item.reject);
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
