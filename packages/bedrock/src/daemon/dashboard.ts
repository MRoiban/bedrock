import type { DaemonConfig } from "./config";
import type { DaemonDatabase, PebbleRecord } from "./db";
import type { Sessions } from "../auth/sessions";
import { authPage, cookieToken, escapeHtml } from "../auth/http";
import { enforceAccess } from "../auth/policy";

// Problems first: the dashboard is opened to check whether anything needs you.
const ORDER: Record<string, number> = { crashed: 0, restarting: 1, stopped: 2, running: 3 };

function deployedAgo(release: string, now = Date.now()) {
  // Release directories are named `<deploy ms>-<id>`; dev releases are project paths.
  const at = Number(/^(\d{13})-/.exec(release.split(/[\\/]/).pop() ?? "")?.[1]);
  if (!at) return "Local dev";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "Deployed just now";
  if (minutes < 60) return `Deployed ${minutes} min ago`;
  if (minutes < 48 * 60) return `Deployed ${Math.round(minutes / 60)} h ago`;
  return `Deployed ${Math.round(minutes / 1440)} days ago`;
}

function tile(record: PebbleRecord, url: string) {
  const name = escapeHtml(record.name);
  const status = record.status === "running" ? `<span class="dot" title="Running"></span>`
    : `<span class="chip ${escapeHtml(record.status)}">${escapeHtml(record.status[0]!.toUpperCase() + record.status.slice(1))}</span>`;
  const meta = record.status === "crashed" ? `Run <code>bedrock logs ${name}</code>` : deployedAgo(record.release);
  return `<li class="${escapeHtml(record.status)}"><a href="${escapeHtml(url)}"><span class="top"><b>${name}</b>${status}</span><span class="meta">${meta}</span></a></li>`;
}

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
  const records = db.list().sort((a, b) => (ORDER[a.status] ?? 1) - (ORDER[b.status] ?? 1) || a.name.localeCompare(b.name));
  const port = new URL(origin).port;
  const tiles = records.map(record => tile(record, dev ? `http://${record.name}.localhost:${port}` : `https://${record.name}.${config.domain}`)).join("");
  const crashed = records.filter(record => record.status === "crashed").length;
  const summary = !records.length ? "No pebbles yet."
    : `${records.length} ${records.length === 1 ? "pebble" : "pebbles"} · ${crashed ? `<span class="bad">${crashed} crashed</span>` : records.every(record => record.status === "running") ? "all running" : `${records.filter(record => record.status === "running").length} running`}`;
  const start = ["bedrock login " + config.domain, "bedrock new my-app", "cd my-app && bedrock dev", "bedrock deploy"].map(line => `<i>$ </i>${escapeHtml(line)}`).join("\n");
  return authPage({
    title: escapeHtml(config.domain), wide: true, heading: escapeHtml(config.domain),
    actions: `<span class="who">${escapeHtml(session.user.email ?? "")}</span><form method="post" action="/sign-out"><button class="link">Sign out</button></form>`,
    body: `<p>${summary}</p>${tiles ? `<ul class="tiles">${tiles}</ul>` : `<div class="first"><p>Make your first pebble from your laptop:</p><pre>${start}</pre></div>`}`,
  });
}

/** A plain form can sign out: these pages run no scripts. */
export function signOut(response: Response) {
  const headers = new Headers({ location: "/", "cache-control": "no-store" });
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}
