import type { DaemonConfig } from "./config";
import type { DaemonDatabase } from "./db";
import type { Sessions } from "../auth/sessions";
import { authPage, cookieToken, escapeHtml } from "../auth/http";
import { enforceAccess } from "../auth/policy";

export function dashboard(request: Request, origin: string, config: DaemonConfig, db: DaemonDatabase, sessions: Sessions, dev: boolean) {
  const session = sessions.resolve(cookieToken(request));
  if (!session) {
    if (!dev && !config.google) return authPage({
      title: "Sign-in not set up", heading: "Sign-in isn’t set up yet",
      body: `<p>Public pebbles already work. To sign in here, run this on the server:</p><pre><i>$ </i>bedrock setup google</pre>`,
    });
    return Response.redirect(`${dev ? `${origin}/_bedrock/dev-login` : `https://auth.${config.domain}/login`}?return=${encodeURIComponent(origin + "/")}`, 302);
  }
  enforceAccess("creators", session.user, config.creators);
  const pebbles = db.list().map(record => {
    const url = new URL(dev ? `http://${record.name}.localhost:${new URL(origin).port}` : `https://${record.name}.${config.domain}`);
    const status = escapeHtml(record.status);
    return `<li><a href="${escapeHtml(url.href)}"><span class="dot ${status}"></span><span><b>${escapeHtml(record.name)}</b><small>${escapeHtml(url.host)}</small></span><span class="state">${status}</span></a></li>`;
  }).join("");
  const start = ["bedrock login " + config.domain, "bedrock new my-app", "cd my-app && bedrock dev", "bedrock deploy"].map(line => `<i>$ </i>${escapeHtml(line)}`).join("\n");
  return authPage({
    title: "Your server", heading: "Your server is ready",
    body: `<p>Signed in as <strong>${escapeHtml(session.user.email ?? "creator")}</strong>.</p>${pebbles ? `<ul>${pebbles}</ul>` : `<p>Make your first pebble from your laptop:</p><pre>${start}</pre>`}`,
  });
}
