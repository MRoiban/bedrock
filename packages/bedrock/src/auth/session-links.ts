import type { User } from "../config";
import type { DaemonConfig } from "../daemon/config";
import type { DaemonDatabase } from "../daemon/db";
import { tokenHash } from "../daemon/db";
import { requireCreator } from "../daemon/creator";
import { BedrockError } from "../error";
import { authPage, escapeHtml, noticePage, requireOrigin, sessionCookie } from "./http";
import { randomToken, type Sessions } from "./sessions";

export function sessionTtl(value: unknown = "15m") {
  const match = typeof value === "string" && /^(\d+)(s|m|h)$/.exec(value);
  const ttl = match ? Number(match[1]) * ({ s: 1000, m: 60_000, h: 3_600_000 }[match[2]!] ?? 0) : 0;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 3_600_000) throw new BedrockError("INVALID_ARGS", "Session TTL must be positive and at most one hour.", "Use --ttl 15m (default), or a duration in s, m, or h up to 1h.");
  return ttl;
}

const path = "/_bedrock/session";
// Fragments never reach HTTP access logs. Only an explicit button press sends the secret in a POST body.
const confirmScript = `const token = location.hash.slice(1); history.replaceState(null, "", location.pathname); if (/^[a-f0-9]{64}$/.test(token)) { document.querySelector('[name="token"]').value = token; document.querySelector('button').disabled = false; } else { document.querySelector('p').textContent = 'This sign-in link is invalid. Run bedrock session create again.'; }`;

export function createSessionLinks(db: DaemonDatabase, sessions: Sessions, config: DaemonConfig, dev = false, now = Date.now) {
  function create(user: User, pebble: string, ttl: unknown, origin: string) {
    requireCreator(user, config.creators);
    const expiresAt = now() + sessionTtl(ttl);
    const token = randomToken();
    db.db.query("DELETE FROM session_links WHERE expires_at<=?").run(now());
    db.db.query("INSERT INTO session_links VALUES (?, ?, ?, ?)").run(tokenHash(token), user.id, pebble, expiresAt);
    return { url: `${origin}${path}#${token}`, expiresAt };
  }
  async function handle(request: Request, origin: string, pebble: string) {
    if (request.method === "GET") {
      const hash = new Bun.CryptoHasher("sha256").update(confirmScript).digest("base64");
      const response = authPage({ title: "Confirm sign-in", heading: `Sign in to ${escapeHtml(pebble)}`, body: `<p>This one-time link signs you in as a server creator until its expiry. Continue only if you requested it.</p><form method="post" action="${path}"><input type="hidden" name="token"><button class="primary" disabled>Sign in</button></form><noscript>Enable JavaScript to use this link.</noscript><script>${confirmScript}</script>` });
      response.headers.set("content-security-policy", `${response.headers.get("content-security-policy")}; script-src 'sha256-${hash}'`);
      response.headers.set("referrer-policy", "no-referrer");
      return response;
    }
    if (request.method !== "POST") throw new BedrockError("NOT_FOUND", "Unknown session link method.", "Open the one-time URL and confirm sign-in.");
    requireOrigin(request, origin);
    const token = String((await request.formData()).get("token") ?? "");
    const result = db.db.transaction(() => {
      if (!/^[a-f0-9]{64}$/.test(token)) return null;
      const row = db.db.query(`SELECT u.id, u.email, u.name, COALESCE(u.avatar_url, '') AS avatarUrl, l.expires_at
        FROM session_links l JOIN users u ON u.id=l.user_id WHERE l.hash=? AND l.pebble=? AND l.expires_at>?`).get(tokenHash(token), pebble, now()) as (User & { expires_at: number }) | null;
      if (!row) return null;
      requireCreator(row, config.creators);
      // Consume and mint in one transaction, with no await between them, so concurrent requests cannot double-spend.
      db.db.query("DELETE FROM session_links WHERE hash=?").run(tokenHash(token));
      return { token: sessions.create(row.id, row.expires_at), expiresAt: row.expires_at };
    })();
    if (!result) {
      const response = noticePage(400, "This sign-in link is invalid or expired", "Run <code>bedrock session create &lt;pebble&gt; --as &lt;creator-email&gt;</code> for a new link.", "INVALID_SESSION_LINK");
      response.headers.set("referrer-policy", "no-referrer");
      return response;
    }
    return new Response(null, { status: 303, headers: { location: `${origin}/`, "set-cookie": sessionCookie(result.token, config.domain, dev, result.expiresAt), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }
  return { create, handle };
}
export type SessionLinks = ReturnType<typeof createSessionLinks>;
