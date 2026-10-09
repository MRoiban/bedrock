import { browserEnvironment } from "./browser";
import { releaseTracker } from "./release";
import { restorePlace } from "./restore";
import type { User } from "../config/types";
import { storageClient } from "./storage";
import type { PebbleConfig } from "../config/types";
import { BedrockError, asBedrockError } from "../error";
import type { Client, ClientOptions } from "./types";
import { httpClient } from "./http";
import { subscriptionStore } from "./subscriptions";
import { pendingMutations } from "./pending";
import { socketProtocol } from "./protocol";
import { clientTransport } from "./transport";
import { wireArgs } from "./wire";

export type { UploadOptions } from "./storage";
export type { Client, ClientOptions, Connection, ClientResult, JsonResult } from "./types";
export type { Release } from "./release";
export { BedrockError } from "../error";

export function createClient<P extends PebbleConfig>(options: ClientOptions = {}): Client<P> {
  const origin = options.url ?? (typeof location !== "undefined" ? location.origin : undefined);
  if (!origin) throw new BedrockError("CLIENT_URL_REQUIRED", "A client URL is required outside a browser.", "Pass createClient({ url: 'http://localhost:3000' }).");
  let base: URL;
  try {
    base = new URL(origin);
    if (!["http:", "https:"].includes(base.protocol)) throw new Error("Expected HTTP or HTTPS");
  } catch (error) { throw asBedrockError(error, "INVALID_CLIENT_URL", "Pass an absolute HTTP or HTTPS pebble URL."); }
  let sequence = 0;
  let mutations = 0, uploads = 0;
  const browser = browserEnvironment();
  const release = releaseTracker(options, browser, () => transport.suspended() || pending.size() > 0 || mutations > 0 || uploads > 0);
  const restore = restorePlace(options.token ? undefined : browser);
  const pending = pendingMutations({ settled: () => transport.settled(), checkRelease: release.check });
  const subscriptions = subscriptionStore(browser, options.pollInterval ?? 5000, {
    closed: () => transport.closed(), suspended: () => transport.suspended(), polling: () => transport.polling(),
    query: (name, args) => http.http("q", name, args), data: restore.data,
  });
  const protocol = socketProtocol(subscriptions, pending, release.observe, () => transport.settled());
  const transport = clientTransport(base, options, browser, {
    busy: () => subscriptions.entries.size > 0 || pending.size() > 0,
    quiet: () => !subscriptions.entries.size && !pending.size() && !mutations,
    request: (path, init) => http.request(path, init),
    stopPoll: subscriptions.stopPoll, poll: subscriptions.poll,
    fallback: () => pending.fallback(trackedMutation), report: subscriptions.report,
    rejectSent: pending.rejectSent, opened: protocol.opened, message: protocol.message, checkRelease: release.check,
  });
  function received(response: Response) {
    transport.received();
    release.observe(response.headers.get("x-bedrock-release"));
  }
  const http = httpClient(base, options, { closed: transport.closed, received, offline: transport.offline });
  async function trackedMutation(name: string, args: unknown) {
    mutations++;
    transport.httpMutation();
    try { const value = await http.http("m", name, args); await subscriptions.refreshAll(); return value; }
    finally { mutations--; transport.settled(); release.check(); }
  }
  return {
    connection: transport.connection,
    onConnection: transport.onConnection,
    async fetch(path, init = {}) {
      let url: URL;
      try { url = new URL(path, base); }
      catch (error) { throw asBedrockError(error, "INVALID_ARGS", "Use a same-origin route URL."); }
      if (url.origin !== base.origin) throw new BedrockError("INVALID_ARGS", "Custom requests must use the client origin.", "Use a same-origin route URL.");
      mutations++;
      try {
        const response = await http.request(url, init);
        if (response.ok && !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase()) && transport.polling()) await subscriptions.refreshAll();
        return response;
      } finally { mutations--; transport.settled(); release.check(); }
    },
    async user(): Promise<User | null> { return (await http.authRequest("/_bedrock/me", "GET", "OFFLINE")).user; },
    loginUrl(returnTo = typeof location !== "undefined" ? location.href : base.href) {
      const dev = base.hostname.endsWith(".localhost");
      const login = dev ? new URL("/_bedrock/dev-login", base) : new URL(`https://auth.${base.hostname.split(".").slice(1).join(".")}/login`);
      login.searchParams.set("return", returnTo);
      return login.href;
    },
    async logout() { await http.authRequest("/_bedrock/logout", "POST"); },
    release: release.release,
    onRelease: release.onRelease,
    ...storageClient(base, options, transport.closed, received, change => { uploads += change; release.check(); }, transport.offline),
    query: (name, args) => http.http("q", name, args),
    mutate(name, args) {
      if (transport.closed()) return Promise.reject(new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client."));
      if (transport.polling()) return trackedMutation(name, args);
      if (pending.size() >= 1000) return Promise.reject(new BedrockError("MUTATION_LIMIT", "Too many pending mutations.", "Wait for earlier mutations to finish."));
      let serialized: unknown;
      try { serialized = wireArgs(args); } catch (error) { return Promise.reject(error); }
      return pending.enqueue(`m${++sequence}`, name, serialized, () => {
        if (transport.socket()?.readyState === 1) pending.flush(transport.send); else transport.connect();
      });
    },
    subscribe(query, args, onData, onError) {
      if (transport.closed()) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
      const id = `s${++sequence}`;
      args = wireArgs(args);
      subscriptions.entries.set(id, { query, args, onData, onError });
      restore.subscribe(id);
      if (transport.polling()) {
        transport.subscription();
        void subscriptions.refresh(id, subscriptions.entries.get(id)!).finally(subscriptions.schedulePoll);
        if (!transport.unavailable()) transport.connect();
      } else if (transport.socket()?.readyState === 1) transport.send({ op: "sub", id, query, args: args ?? null });
      else transport.connect();
      return () => {
        subscriptions.entries.delete(id);
        restore.unsubscribe(id);
        if (transport.socket()?.readyState === 1) transport.send({ op: "unsub", id });
        transport.settled();
      };
    },
    close() {
      // Mark closed before any release or pending-work callbacks run.
      const ws = transport.close();
      release.close(); restore.close();
      subscriptions.entries.clear();
      pending.close();
      ws?.close(1000, "Client closed");
    },
  };
}
