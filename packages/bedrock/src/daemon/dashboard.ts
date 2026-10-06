import type { DaemonConfig } from "./config";
import type { DaemonDatabase } from "./db";
import type { Sessions } from "../auth/sessions";
import { authPage, cookieToken, escapeHtml } from "../auth/http";
import { enforceAccess } from "../auth/policy";

export function dashboard(request: Request, origin: string, config: DaemonConfig, db: DaemonDatabase, sessions: Sessions, dev: boolean) {
  const session = sessions.resolve(cookieToken(request));
  if (!session) {
    if (!dev && !config.google) return authPage("<p>Google sign-in is not configured. On the server, run <code>bedrock setup google</code>. Public pebbles are ready to use.</p>");
    return Response.redirect(`${dev ? `${origin}/_bedrock/dev-login` : `https://auth.${config.domain}/login`}?return=${encodeURIComponent(origin + "/")}`, 302);
  }
  enforceAccess("creators", session.user, config.creators);
  const pebbles = db.list().map(record => {
    const url = dev ? `http://${record.name}.localhost:${new URL(origin).port}` : `https://${record.name}.${config.domain}`;
    return `<li><a href="${escapeHtml(url)}">${escapeHtml(record.name)}</a> · ${escapeHtml(record.status)}</li>`;
  }).join("");
  return authPage(`<p>Signed in as ${escapeHtml(session.user.email ?? "creator")}. Your server is ready.</p>${pebbles ? `<ul>${pebbles}</ul>` : "<p>On your laptop:<br><code>bedrock login " + escapeHtml(config.domain) + "<br>bedrock new my-app<br>cd my-app &amp;&amp; bedrock dev<br>bedrock deploy</code></p>"}`);
}
