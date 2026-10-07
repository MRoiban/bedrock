import type { DaemonConfig } from "../daemon/config";
import type { DaemonDatabase } from "../daemon/db";
import { BedrockError } from "../error";
import { authPage, cookieToken, escapeHtml, requireOrigin } from "./http";
import { enforceAccess } from "./policy";
import { randomToken, type Sessions } from "./sessions";

export function createCliLogin(config: DaemonConfig, sessions: Sessions, db: DaemonDatabase, dev = false) {
  const pending = new Map<string, { hash: string; port: number; state: string; expires: number }>();
  return async (request: Request, origin: string) => {
    const url = new URL(request.url);
    const session = sessions.resolve(cookieToken(request));
    if (!session) {
      const returnTo = `${origin}${url.pathname}${url.search}`;
      return Response.redirect(`${dev ? `${origin}/_bedrock/dev-login` : `https://auth.${config.domain}/login`}?return=${encodeURIComponent(returnTo)}`, 302);
    }
    enforceAccess("creators", session.user, config.creators);
    if (request.method === "GET") {
      const port = Number(url.searchParams.get("port"));
      const state = url.searchParams.get("state") ?? "";
      const host = url.searchParams.get("hostname") ?? "this computer";
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{64}$/.test(state) || host.length > 255) throw new BedrockError("INVALID_ARGS", "Invalid CLI login callback.", "Run bedrock login again.");
      for (const [key, item] of pending) if (item.expires <= Date.now()) pending.delete(key);
      if (pending.size >= 1000) throw new BedrockError("LOGIN_LIMIT", "Too many pending CLI authorizations.", "Wait five minutes and retry.");
      const nonce = randomToken();
      pending.set(nonce, { hash: session.hash, port, state, expires: Date.now() + 300000 });
      return authPage({
        title: "Authorize CLI", heading: `Authorize CLI on ${escapeHtml(host)}?`,
        formAction: ["http://127.0.0.1:*"],
        body: `<p>It gets your creator access: it can deploy, restart and delete every pebble on this server.</p><form method="post" action="/cli-login"><input type="hidden" name="nonce" value="${nonce}"><button class="primary">Authorize CLI</button></form><p class="note">Didn’t just run <code>bedrock login</code>? Close this tab.</p>`,
      });
    }
    if (request.method !== "POST") throw new BedrockError("NOT_FOUND", "Unknown CLI login method.", "Run bedrock login again.");
    requireOrigin(request, origin);
    const nonce = String((await request.formData()).get("nonce") ?? "");
    const item = pending.get(nonce);
    if (!item || item.hash !== session.hash || item.expires <= Date.now()) throw new BedrockError("INVALID_OAUTH_STATE", "CLI authorization expired or was already used.", "Run bedrock login again.");
    pending.delete(nonce);
    const callback = new URL(`http://127.0.0.1:${item.port}/callback`);
    callback.searchParams.set("state", item.state);
    callback.searchParams.set("token", db.createToken(session.user.email));
    return new Response(null, { status: 302, headers: { location: callback.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  };
}
