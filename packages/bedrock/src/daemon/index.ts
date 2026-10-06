import { join, resolve } from "node:path";
import { asBedrockError } from "../error";
import { atomicWrite, bedrockHome, readConfig, validateConfig } from "./config";
import { localToken, openDaemonDatabase } from "./db";
import { createApi, daemonError } from "./api";
import { hostTarget, proxyHttp, proxyWebSocket, relayWebSocket, type Relay } from "./proxy";
import { Releases } from "./releases";
import { Supervisor } from "./supervisor";

export interface StartDaemonOptions { home?: string; port?: number; domain?: string }

export async function startDaemon(options: StartDaemonOptions = {}) {
  const home = resolve(options.home ?? bedrockHome());
  const stored = await readConfig(home);
  const config = validateConfig({ ...stored, port: options.port ?? stored.port, domain: options.domain ?? stored.domain });
  const db = await openDaemonDatabase(home);
  const supervisor = new Supervisor(home, db);
  const releases = new Releases(home, db, supervisor);
  let server: Bun.Server<Relay> | undefined;
  try {
    await localToken(home, db);
    const api = createApi(db, releases, supervisor);
    const notFound = () => new Response("Pebble not found. Deploy it with bedrock deploy, or check its hostname.", { status: 404 });
    server = Bun.serve<Relay>({
      hostname: "127.0.0.1", port: config.port, maxRequestBodySize: 256 * 1024 * 1024,
      websocket: relayWebSocket,
      async fetch(request, server) {
        try {
          const target = hostTarget(request.headers.get("host") ?? "", config.domain);
          if (target === "bedrock") return await api(request);
          if (!target || ["auth", "www"].includes(target)) return notFound();
          const child = supervisor.child(target);
          if (!child) return notFound();
          if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return await proxyWebSocket(request, server, child.port);
          child.requests++;
          return await proxyHttp(request, child.port, () => { child.requests--; });
        } catch (error) { return daemonError(error); }
      },
      error: daemonError,
    });
    await supervisor.restore();
    await atomicWrite(join(home, "daemon.json"), JSON.stringify({ port: server.port, domain: config.domain }) + "\n");
    let stopping: Promise<void> | undefined;
    return {
      server, home,
      stop() {
        return stopping ??= (async () => {
          await releases.shutdown();
          await server!.stop(true);
          await supervisor.shutdown();
          db.close();
        })();
      },
    };
  } catch (error) {
    await server?.stop(true);
    await supervisor.shutdown();
    db.close();
    throw asBedrockError(error, "DAEMON_START_FAILED", "Check setup, the listen port, and daemon home permissions.");
  }
}
