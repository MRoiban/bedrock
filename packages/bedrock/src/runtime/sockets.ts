import { BedrockError, asBedrockError } from "../error";
import { socketSize, type ApplicationSocket, type DetachedContext, type PebbleConfig, type SocketDefinition } from "../config";
import type { SocketData } from "../sync";
import type { createExecutor } from "./functions";
import { checkAccess } from "./access";
import { requirePermission } from "./tokens";
import { errorResponse } from "./http";

export interface AppSocketData extends SocketData { kind: "application"; path: string; definition: SocketDefinition; value?: unknown; context: DetachedContext }
export type RuntimeSocketData = SocketData | AppSocketData;
export function isApplication(data: RuntimeSocketData): data is AppSocketData { return "kind" in data && data.kind === "application"; }
export function createApplicationSockets(pebble: PebbleConfig, execute: ReturnType<typeof createExecutor>) {
  let accepting = true;
  const views = new WeakMap<Bun.ServerWebSocket<AppSocketData>, ApplicationSocket>();
  function application(ws: Bun.ServerWebSocket<AppSocketData>): ApplicationSocket {
    let view = views.get(ws);
    if (!view) {
      const configured = ws.data.definition.backpressureLimit;
      const limit = configured === undefined ? undefined : socketSize(configured);
      // Bind native methods to their actual Bun receiver; retain one view across callbacks.
      view = new Proxy(ws, {
        get(target, key) {
          const value = Reflect.get(target, key, target);
          if (typeof value !== "function") return value;
          if (key === "send" || key === "sendText" || key === "sendBinary") return (...args: unknown[]) => {
            if (limit !== undefined && target.getBufferedAmount() > limit) { target.close(1013, "Slow consumer"); return 0; }
            const sent = value.apply(target, args);
            if (limit !== undefined && target.getBufferedAmount() > limit) target.close(1013, "Slow consumer");
            return sent;
          };
          return value.bind(target);
        },
      }) as ApplicationSocket;
      views.set(ws, view);
    }
    return view;
  }
  const sockets = new Set<Bun.ServerWebSocket<AppSocketData>>();
  function invoke(ws: Bun.ServerWebSocket<AppSocketData>, callback: (() => unknown) | undefined) {
    if (!callback) return;
    void Promise.resolve().then(callback).catch(error => { console.error("Application socket handler failed", asBedrockError(error, "SOCKET_FAILED", "Check the application socket handler and its read/write callbacks.").toJSON()); ws.close(1011, "Handler failed"); });
  }
  const websocket: Bun.WebSocketHandler<AppSocketData> = {
    open(ws) { if (!accepting) { ws.close(1012, "Service restart"); return; } sockets.add(ws); invoke(ws, () => ws.data.definition.open?.(application(ws), ws.data.context)); },
    message(ws, message) {
      invoke(ws, async () => {
        // Bearer validity is rechecked rather than freezing an expired credential at upgrade.
        const identity = ws.data.token ? await execute.identify(ws.data.request) : { user: ws.data.user, token: null };
        checkAccess(pebble, identity.user);
        requirePermission(identity.token, `socket:${ws.data.path}`);
        return ws.data.definition.message(application(ws), message, ws.data.context);
      });
    },
    close(ws, code, reason) { sockets.delete(ws); invoke(ws, () => ws.data.definition.close?.(application(ws), code, reason, ws.data.context)); },
    drain(ws) { invoke(ws, () => ws.data.definition.drain?.(application(ws), ws.data.context)); },
  };
  return {
    websocket,
    async upgrade(path: string, request: Request, server: Bun.Server<RuntimeSocketData>) {
      try {
        // Bun 1.2 consumes the upgrade Request; retain immutable admission metadata.
        const original = new Request(request.url, { method: request.method, headers: new Headers(request.headers) });
        const identity = await execute.identify(original);
        checkAccess(pebble, identity.user);
        requirePermission(identity.token, `socket:${path}`);
        // Returning the detached context releases the tracking promise immediately.
        const context = await execute.detached(original, ctx => ctx, identity);
        if (!accepting) throw new BedrockError("PEBBLE_STOPPED", "The pebble is stopping.", "Reconnect to the next release.");
        if (server.upgrade(request, { data: { ...identity, request: original, kind: "application", path, definition: pebble.sockets![path]!, context } })) return;
        return new Response("WebSocket upgrade required", { status: 426 });
      } catch (error) { return errorResponse(error); }
    },
    close() { accepting = false; for (const ws of sockets) ws.close(1012, "Service restart"); },
  };
}
