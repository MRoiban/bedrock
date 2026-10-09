import type { Connection } from "./types";

type Timer = ReturnType<typeof setTimeout>;
export type SocketPhase =
  | { kind: "idle" }
  | { kind: "opening"; socket: WebSocket }
  | { kind: "live"; socket: WebSocket }
  | { kind: "backoff"; timer: Timer }
  | { kind: "probing"; generation: number };

// HTTP freshness can continue during a socket attempt; offline is a report of
// network health, not evidence that an existing socket has closed.
export interface TransportState {
  phase: SocketPhase;
  lifecycle: "active" | "suspended" | "closed";
  freshness: "socket" | "temporary" | "permanent";
  attempted: boolean;
  refused: number;
  generation: number;
  attempt: number;
  connection: Connection;
}
export type TransportEvent =
  | { type: "connect" }
  | { type: "socket"; socket: WebSocket }
  | { type: "open"; socket: WebSocket }
  | { type: "disconnect" }
  | { type: "refused" }
  | { type: "probe" }
  | { type: "probed"; generation: number }
  | { type: "retry"; restarting: boolean }
  | { type: "backoff"; timer: Timer }
  | { type: "fallback"; permanent: boolean }
  | { type: "denied" }
  | { type: "polling" }
  | { type: "offline" }
  | { type: "response"; busy: boolean }
  | { type: "hide" }
  | { type: "hidden"; busy: boolean }
  | { type: "survived" }
  | { type: "resume" }
  | { type: "idle" }
  | { type: "close" };

export function initialTransport(permanent: boolean, offline: boolean): TransportState {
  return {
    phase: { kind: "idle" }, lifecycle: "active", freshness: permanent ? "permanent" : "socket",
    attempted: false, refused: 0, generation: 0, attempt: 0,
    connection: { state: offline ? "offline" : "idle", since: Date.now(), attempt: 0 },
  };
}
export const socketOf = (state: TransportState) =>
  state.phase.kind === "opening" || state.phase.kind === "live" ? state.phase.socket : undefined;
export const isPolling = (state: TransportState) => state.freshness !== "socket";

export function transition(previous: TransportState, event: TransportEvent, browserOffline: boolean): TransportState {
  const next = { ...previous };
  let report: Connection["state"] | undefined;
  const offline = previous.connection.state === "offline";
  switch (event.type) {
    case "connect":
      if (!isPolling(previous) && !offline) report = previous.attempted ? "reconnecting" : "connecting";
      next.attempted = true;
      break;
    case "socket": next.phase = { kind: "opening", socket: event.socket }; break;
    case "open":
      next.phase = { kind: "live", socket: event.socket };
      next.attempt = 0; next.refused = 0; next.freshness = "socket"; report = "live";
      break;
    case "disconnect": next.phase = { kind: "idle" }; break;
    case "refused": next.refused++; break;
    case "probe": next.phase = { kind: "probing", generation: ++next.generation }; break;
    case "probed":
      if (next.phase.kind === "probing" && next.generation === event.generation) next.phase = { kind: "idle" };
      break;
    case "retry":
      if (!event.restarting) next.attempt++;
      report = !isPolling(previous) && !offline ? "reconnecting" : previous.connection.state;
      break;
    case "backoff": next.phase = { kind: "backoff", timer: event.timer }; break;
    case "fallback":
      if (event.permanent || next.freshness === "permanent") next.freshness = "permanent";
      else next.freshness = "temporary";
      if (!offline) report = "polling";
      break;
    case "denied": next.freshness = "socket"; report = "reconnecting"; break;
    case "polling": if (!offline) report = "polling"; break;
    case "offline": report = "offline"; break;
    case "response":
      if (offline) report = socketOf(previous)?.readyState === 1 ? "live" : isPolling(previous) ? "polling" : event.busy ? "reconnecting" : "idle";
      break;
    case "hide":
      next.lifecycle = "suspended"; next.generation++; next.phase = { kind: "idle" };
      break;
    case "hidden":
      if (event.busy && !isPolling(previous) && !offline) report = "reconnecting";
      break;
    case "survived": report = "live"; break;
    case "resume":
      next.lifecycle = "active"; next.generation++; next.attempt = 0;
      if (!socketOf(previous)) next.phase = { kind: "idle" };
      break;
    case "idle":
      next.generation++; next.phase = { kind: "idle" };
      next.attempt = 0; next.refused = 0; next.attempted = false;
      if (!offline) report = "idle";
      break;
    case "close": next.lifecycle = "closed"; next.phase = { kind: "idle" }; report = "idle"; break;
  }
  if (report !== undefined && (next.lifecycle !== "closed" || report === "idle")) {
    if (browserOffline && report !== "idle") report = "offline";
    next.connection = {
      state: report,
      since: report !== previous.connection.state ? Date.now() : previous.connection.since,
      attempt: next.attempt,
    };
  }
  return next;
}
