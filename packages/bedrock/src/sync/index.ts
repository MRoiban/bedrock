import type { ServerWebSocket } from "bun";
import type { User } from "../config";
import type { createExecutor } from "../runtime/functions";
import { BedrockError, asBedrockError } from "../error";

/* JSON protocol:
 * client: {op:"sub",id,query,args} | {op:"unsub",id} | {op:"mut",id,mutation,args}
 * server: {op:"hello",release} | {op:"data",id,result} | {op:"result",id,ok,value|error} | {op:"error",id,error}
 * Errors contain BedrockError's {code,message,hint}. IDs are nonempty strings.
 */
export interface SocketData { token?: import("../config").TokenIdentity | null; user: User | null; request: Request }
type Socket = ServerWebSocket<SocketData>;
interface Subscription {
  socket: Socket;
  user: User | null;
  id: string;
  query: string;
  args: unknown;
  reads: Set<string>;
  hash?: string;
  timer?: ReturnType<typeof setTimeout>;
  active: boolean;
}
const fail = (code: string, message: string) => new BedrockError(code, message, "Use the documented Bedrock WebSocket protocol.");
const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value ?? null)).digest("hex");

export function createSync(execute: ReturnType<typeof createExecutor>, release: string) {
  const sockets = new Map<Socket, Map<string, Subscription>>();
  function send(socket: Socket, message: object) {
    const sent = socket.send(JSON.stringify(message));
    // A slow consumer must reconnect rather than accumulate unbounded data.
    if (sent === -1 || socket.getBufferedAmount() > 1024 * 1024) socket.close(1013, "Slow consumer");
  }
  function remove(sub: Subscription) {
    sub.active = false;
    clearTimeout(sub.timer);
    sockets.get(sub.socket)?.delete(sub.id);
  }
  async function refresh(sub: Subscription, validated: boolean) {
    try {
      const result = await execute("query", sub.query, sub.args, sub.socket.data.request, sub.socket.data.token ? undefined : { user: sub.user, validated });
      if (!sub.active) return;
      sub.args = result.args;
      sub.reads = result.reads;
      const next = hash(result.value);
      if (next !== sub.hash) {
        sub.hash = next;
        send(sub.socket, { op: "data", id: sub.id, result: result.value ?? null });
      }
    } catch (error) {
      if (sub.active) send(sub.socket, { op: "error", id: sub.id, error: asBedrockError(error).toJSON() });
      // Failed queries may not have a complete read-set; retry on any write.
      sub.reads = new Set(["*"]);
    }
  }
  const detach = execute.onCommit(writes => {
    for (const subscriptions of sockets.values()) {
      for (const sub of subscriptions.values()) {
        if (sub.timer || ![...sub.reads].some(table => table === "*" || writes.has(table))) continue;
        sub.timer = setTimeout(() => {
          delete sub.timer;
          if (sub.active) void refresh(sub, sub.hash !== undefined);
        }, 16);
      }
    }
  });
  return {
    websocket: {
      maxPayloadLength: 64 * 1024,
      idleTimeout: 60,
      sendPings: true,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      open(socket: Socket) { sockets.set(socket, new Map()); send(socket, { op: "hello", release }); },
      close(socket: Socket) {
        for (const sub of sockets.get(socket)?.values() ?? []) remove(sub);
        sockets.delete(socket);
      },
      async message(socket: Socket, raw: string | Buffer) {
        let id = "";
        try {
          const message = JSON.parse(typeof raw === "string" ? raw : raw.toString());
          if (!message || typeof message !== "object" || typeof message.id !== "string" || !message.id || message.id.length > 128) throw fail("INVALID_MESSAGE", "A message needs a string id of at most 128 characters.");
          id = message.id;
          const subscriptions = sockets.get(socket);
          if (!subscriptions) return;
          if (message.op === "unsub") {
            const sub = subscriptions.get(id);
            if (sub) remove(sub);
          } else if (message.op === "sub") {
            if (typeof message.query !== "string") throw fail("INVALID_MESSAGE", "A subscription needs a query name.");
            if (subscriptions.has(id)) throw fail("DUPLICATE_SUBSCRIPTION", "This subscription id is already in use.");
            if (subscriptions.size >= 100) throw fail("SUBSCRIPTION_LIMIT", "A socket supports at most 100 subscriptions.");
            const sub: Subscription = { socket, user: socket.data.user, id, query: message.query, args: message.args, reads: new Set(["*"]), active: true };
            subscriptions.set(id, sub);
            await refresh(sub, false);
          } else if (message.op === "mut") {
            if (typeof message.mutation !== "string") throw fail("INVALID_MESSAGE", "A mutation needs a mutation name.");
            try {
              const result = await execute("mutation", message.mutation, message.args, socket.data.request, socket.data.token ? undefined : { user: socket.data.user });
              for (const sub of subscriptions.values()) {
                if (![...sub.reads].some(table => table === "*" || result.writes.has(table))) continue;
                clearTimeout(sub.timer);
                delete sub.timer;
                await refresh(sub, sub.hash !== undefined);
              }
              send(socket, { op: "result", id, ok: true, value: result.value ?? null });
            } catch (error) { send(socket, { op: "result", id, ok: false, error: asBedrockError(error).toJSON() }); }
          } else throw fail("INVALID_MESSAGE", "Unknown operation.");
        } catch (error) { send(socket, { op: "error", id, error: asBedrockError(error, "INVALID_MESSAGE", "Send a JSON protocol message.").toJSON() }); }
      },
    },
    close() {
      detach();
      for (const [socket, subscriptions] of sockets) {
        for (const sub of subscriptions.values()) remove(sub);
        socket.close(1012, "Service restart");
      }
      sockets.clear();
    },
  };
}
