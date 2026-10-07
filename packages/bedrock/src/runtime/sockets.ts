import { BedrockError, asBedrockError } from "../error";
import type { ApplicationSocket, DetachedContext, PebbleConfig, SocketDefinition } from "../config";
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
  const sockets = new Set<Bun.ServerWebSocket<AppSocketData>>();
  function invoke(ws: Bun.ServerWebSocket<AppSocketData>, callback: (() => unknown) | undefined) {
    if (!callback) return;
    void Promise.resolve().then(callback).catch(error => { console.error("Application socket handler failed", asBedrockError(error, "SOCKET_FAILED", "Check the application socket handler and its read/write callbacks.").toJSON()); ws.close(1011, "Handler failed"); });
  }
  const websocket: Bun.WebSocketHandler<AppSocketData> = {
    open(ws) { if (!accepting) { ws.close(1012, "Service restart"); return; } sockets.add(ws); invoke(ws, () => ws.data.definition.open?.(ws as ApplicationSocket, ws.data.context)); },
    message(ws, message) {
      invoke(ws, async () => {
        // Bearer validity is rechecked rather than freezing an expired credential at upgrade.
        const identity = ws.data.token ? await execute.identify(ws.data.request) : { user: ws.data.user, token: null };
        checkAccess(pebble, identity.user);
        requirePermission(identity.token, `socket:${ws.data.path}`);
        return ws.data.definition.message(ws as ApplicationSocket, message, ws.data.context);
      });
    },
    close(ws, code, reason) { sockets.delete(ws); invoke(ws, () => ws.data.definition.close?.(ws as ApplicationSocket, code, reason, ws.data.context)); },
    drain(ws) { invoke(ws, () => ws.data.definition.drain?.(ws as ApplicationSocket, ws.data.context)); },
  };
  return {
    websocket,
    async upgrade(path: string, request: Request, server: Bun.Server<RuntimeSocketData>) {
      try {
        const identity = await execute.identify(request);
        checkAccess(pebble, identity.user);
        requirePermission(identity.token, `socket:${path}`);
        // Returning the detached context releases the tracking promise immediately.
        const context = await execute.detached(request, ctx => ctx, identity);
        if (!accepting) throw new BedrockError("PEBBLE_STOPPED", "The pebble is stopping.", "Reconnect to the next release.");
        if (server.upgrade(request, { data: { ...identity, request, kind: "application", path, definition: pebble.sockets![path]!, context } })) return;
        return new Response("WebSocket upgrade required", { status: 426 });
      } catch (error) { return errorResponse(error); }
    },
    close() { accepting = false; for (const ws of sockets) ws.close(1012, "Service restart"); },
  };
}
