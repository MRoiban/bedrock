import { Google, generateCodeVerifier, generateState } from "arctic";
import { tokenHash } from "../daemon/db";
import type { DaemonConfig } from "../daemon/config";
import { BedrockError } from "../error";
import type { Sessions } from "./sessions";
import { SESSION_LIFETIME, randomToken } from "./sessions";
import { GOOGLE_G, authPage, cookieToken, escapeHtml, requireOrigin, sessionCookie, validateReturn } from "./http";

// Name the place the visitor is going, not the server they are signing in to.
function destination(returnTo: string) {
  const label = new URL(returnTo).hostname.split(".")[0]!;
  return label === "bedrock" ? "Bedrock" : label;
}

export interface OAuthProvider {
  createAuthorizationURL(state: string, verifier: string, scopes: string[]): URL;
  validateAuthorizationCode(code: string, verifier: string): Promise<{ accessToken(): string }>;
}
export interface AuthOptions {
  oauth?: OAuthProvider;
  profile?: (accessToken: string) => Promise<{ email: string; email_verified: boolean; name?: string; picture?: string }>;
}
interface PendingLogin { verifier: string; binding: string; returnTo: string; expiresAt: number }

export function createAuth(config: DaemonConfig, dev: boolean, sessions: Sessions, onLogout: (hash: string) => void, options: AuthOptions = {}) {
  const oauth = options.oauth ?? (config.google ? new Google(config.google.clientId, config.google.clientSecret, `https://auth.${config.domain}/callback`) : undefined);
  const pending = new Map<string, PendingLogin>();
  const profile = options.profile ?? (async (token: string) => {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new BedrockError("OAUTH_FAILED", "Google could not verify this account.", "Try signing in again.");
    return response.json();
  });
  const cookie = (token: string, expiresAt = Date.now() + SESSION_LIFETIME) => sessionCookie(token, config.domain, dev, expiresAt);
  function revokePrevious(request: Request) {
    const token = cookieToken(request);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
    // Expired sessions may still have sockets awaiting the periodic check.
    const hash = tokenHash(token);
    sessions.revoke(hash);
    onLogout(hash);
  }
  function logout(request: Request, origin: string) {
    requireOrigin(request, origin);
    revokePrevious(request);
    return Response.json({ ok: true }, { headers: { "set-cookie": cookie("", 0), "cache-control": "no-store" } });
  }
  async function devLogin(request: Request, origin: string, path = "/_bedrock/dev-login") {
    const url = new URL(request.url);
    const returnTo = validateReturn(url.searchParams.get("return") ?? `${origin}/`, "localhost", true);
    // Dev cookies are host-only, so the form must remain on the destination host.
    if (new URL(returnTo).origin !== origin) return Response.redirect(`${new URL(returnTo).origin}/_bedrock/dev-login?return=${encodeURIComponent(returnTo)}`, 302);
    if (request.method === "GET") return authPage({
      title: "Sign in", badge: "Local dev", heading: `Sign in to ${escapeHtml(destination(returnTo))}`,
      body: `<p>There is no Google in development. Use any email to act as that person.</p><form method="post" action="${escapeHtml(path)}?return=${escapeHtml(encodeURIComponent(returnTo))}"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email" autocapitalize="off" spellcheck="false" autofocus placeholder="you@example.com"><label for="name">Name <span>(optional)</span></label><input id="name" name="name" autocomplete="name"><button class="primary">Sign in</button></form>`,
    });
    if (request.method !== "POST") throw new BedrockError("NOT_FOUND", "Unknown login method.", "Use the local login form.");
    requireOrigin(request, origin);
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const name = String(form.get("name") ?? "").trim() || email;
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254 || name.length > 200) throw new BedrockError("INVALID_ARGS", "Enter a valid email and a name of at most 200 characters.", "Use the local login form.");
    const user = sessions.user(email, name);
    revokePrevious(request);
    const token = sessions.create(user.id);
    return new Response(null, { status: 302, headers: { location: returnTo, "set-cookie": cookie(token), "cache-control": "no-store" } });
  }
  async function handle(request: Request, origin: string) {
    const url = new URL(request.url);
    if (url.pathname === "/me" && request.method === "GET") {
      const token = cookieToken(request);
      const session = sessions.resolve(token);
      const response = Response.json({ user: session?.user ?? null }, { headers: { "cache-control": "no-store" } });
      if (session?.refreshed) response.headers.append("set-cookie", cookie(token!, session.expiresAt));
      return response;
    }
    if (url.pathname === "/logout" && request.method === "POST") return logout(request, origin);
    if (dev && url.pathname === "/login") return devLogin(request, origin, "/login");
    if (url.pathname === "/login" && request.method === "GET") {
      const returnTo = validateReturn(url.searchParams.get("return") ?? `https://bedrock.${config.domain}/`, config.domain);
      if (!oauth) throw new BedrockError("OAUTH_NOT_CONFIGURED", "Google sign-in is not configured.", "Run bedrock setup with --google-client-id and --google-client-secret.");
      if (url.searchParams.get("start") !== "1") return authPage({
        title: "Sign in", heading: `Sign in to ${escapeHtml(destination(returnTo))}`,
        formAction: ["https://accounts.google.com"],
        body: `<p class="host">${escapeHtml(new URL(returnTo).host)}</p><form method="get" action="/login"><input type="hidden" name="return" value="${escapeHtml(returnTo)}"><input type="hidden" name="start" value="1"><button class="google">${GOOGLE_G}Continue with Google</button></form><p class="note">This server receives only your name, email address and profile photo.</p>`,
      });
      for (const [key, login] of pending) if (login.expiresAt <= Date.now()) pending.delete(key);
      if (pending.size >= 1000) throw new BedrockError("LOGIN_LIMIT", "Too many pending sign-ins.", "Wait a few minutes and try again.");
      const state = generateState();
      const verifier = generateCodeVerifier();
      // __Host- prevents sibling pebbles from planting a parent-domain state cookie.
      const binding = randomToken();
      pending.set(state, { verifier, binding, returnTo, expiresAt: Date.now() + 10 * 60_000 });
      return new Response(null, { status: 302, headers: { location: oauth.createAuthorizationURL(state, verifier, ["openid", "email", "profile"]).toString(), "set-cookie": `__Host-bedrock_oauth=${binding}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, "cache-control": "no-store" } });
    }
    if (url.pathname === "/callback" && request.method === "GET") {
      const state = url.searchParams.get("state") ?? "";
      const login = pending.get(state);
      if (!login || login.expiresAt <= Date.now() || cookieToken(request, "__Host-bedrock_oauth") !== login.binding) throw new BedrockError("INVALID_OAUTH_STATE", "This sign-in attempt is invalid or expired.", "Start again from the login page.");
      // Consume before exchanging the code so callbacks cannot be replayed concurrently.
      pending.delete(state);
      const code = url.searchParams.get("code");
      if (!code || !oauth) throw new BedrockError("OAUTH_FAILED", "Google sign-in was cancelled.", "Start again from the login page.");
      let account: Awaited<ReturnType<typeof profile>>;
      try { account = await profile((await oauth.validateAuthorizationCode(code, login.verifier)).accessToken()); }
      catch { throw new BedrockError("OAUTH_FAILED", "Google sign-in failed.", "Start again from the login page."); }
      if (account.email_verified !== true || typeof account.email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(account.email)) throw new BedrockError("OAUTH_FAILED", "Google did not return a verified email.", "Sign in with a verified Google account.");
      const user = sessions.user(account.email, account.name ?? account.email, account.picture);
      revokePrevious(request);
      const token = sessions.create(user.id);
      const headers = new Headers({ location: login.returnTo, "cache-control": "no-store" });
      headers.append("set-cookie", cookie(token));
      headers.append("set-cookie", "__Host-bedrock_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
      return new Response(null, { status: 302, headers });
    }
    throw new BedrockError("NOT_FOUND", "Unknown auth endpoint.", "Use /login, /callback, /logout, or /me.");
  }
  return { handle, devLogin, logout, cookie };
}
