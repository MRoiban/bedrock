import type { Relay } from "../daemon/proxy";
import type { Sessions } from "./sessions";

export function sessionSockets(sessions: Sessions) {
  const sockets = new Map<Relay, { token: string; hash: string }>();
  function close(relay: Relay) {
    sockets.delete(relay);
    relay.closed = { code: 4001, reason: "Session ended" };
    relay.downstream?.close(4001, "Session ended");
    relay.upstream.close(4001, "Session ended");
  }
  function revalidate() {
    // Socket activity does not slide expiry: cached identity must eventually expire.
    for (const [relay, session] of sockets) if (!sessions.resolve(session.token, false)) close(relay);
  }
  const timer = setInterval(revalidate, 5 * 60_000);
  timer.unref();
  return {
    register(relay: Relay, token: string, hash: string) {
      sockets.set(relay, { token, hash });
      return () => { sockets.delete(relay); };
    },
    revoke(hash: string) { for (const [relay, session] of sockets) if (session.hash === hash) close(relay); },
    revalidate,
    stop() { clearInterval(timer); for (const relay of sockets.keys()) close(relay); },
  };
}
