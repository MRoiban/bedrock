import { BedrockError } from "../error";

export function cookieToken(request: Request, name = "bedrock_session") {
  // Duplicate cookies are ambiguous (a sibling can plant a parent-domain cookie).
  const values = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : null;
}
export function sessionCookie(token: string, domain: string, dev: boolean, expiresAt: number) {
  return `bedrock_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${dev ? "" : `; Domain=.${domain}; Secure`}`;
}
export function validateReturn(value: string, domain: string, dev = false) {
  let url: URL;
  try { url = new URL(value); } catch { throw invalidReturn(); }
  if (url.username || url.password || !url.hostname.endsWith(`.${domain}`) ||
      !/^[a-z0-9-]+$/.test(url.hostname.slice(0, -domain.length - 1)) ||
      url.protocol !== (dev ? "http:" : "https:") || (!dev && url.port)) throw invalidReturn();
  return url.toString();
}
const invalidReturn = () => new BedrockError("INVALID_RETURN_URL", "The return URL must be a Bedrock pebble URL.", "Use an HTTPS URL on a subdomain of your Bedrock domain.");
export function requireOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin) throw new BedrockError("FORBIDDEN", "The request origin does not match this host.", "Send the request from the pebble's own origin; non-browser clients must send its Origin header.");
}
// The auth pages are the only Bedrock UI a visitor is guaranteed to see, and CSP
// allows inline styles only, so the design lives here as one self-contained sheet.
const MARK = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><clipPath id="pebble"><path d="M2.6 14.2C2.2 9.4 6 4.9 11.6 4.3c5.7-.6 9.9 2.4 9.9 7.4 0 5.4-4.3 8.6-9.8 8.6-5 0-8.8-2.2-9.1-6.1z"/></clipPath><g clip-path="url(#pebble)"><path class="s3" d="M0 0h24v9.2c-3 .9-6 .1-9 .4-3 .3-6 1.2-9 .6-3-.6-6-.4-6-.4z"/><path class="s2" d="M0 11.6c3 .4 6 .5 9-.2 3-.7 6-.5 9 .1 3 .6 6 .2 6 .2v3.2c-3 .5-6 .3-9-.3-3-.6-6 .2-9 .6-3 .4-6-.1-6-.1z"/><path class="s1" d="M0 16.6c3 .5 6 .2 9-.5 3-.6 6-.2 9 .4 3 .5 6 .1 6 .1V24H0z"/></g></svg>`;
export const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;
const MONO = `ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace`;
const STYLE = `
:root{color-scheme:light dark;--bg:#f3f1eb;--card:#fffefa;--line:#e4e0d6;--ink:#1c211e;--muted:#646d67;--accent:#2f5d46;--accent-hi:#376b51;--on-accent:#fff;--field:#fff;--field-line:#d4cfc3;--focus:rgba(47,93,70,.25);--shadow:0 1px 0 rgba(28,33,30,.04),0 20px 44px -26px rgba(28,33,30,.3)}
@media (prefers-color-scheme:dark){:root{--bg:#101211;--card:#171a18;--line:#262a27;--ink:#ebe9e3;--muted:#949d96;--accent:#7fb898;--accent-hi:#8fc5a6;--on-accent:#0e1813;--field:#141715;--field-line:#323733;--focus:rgba(127,184,152,.28);--shadow:0 1px 0 rgba(0,0,0,.35),0 20px 44px -26px rgba(0,0,0,.9)}}
*{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
main{width:100%;max-width:400px;padding:26px 28px 28px;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}
.brand{display:flex;align-items:center;gap:9px;margin:0 0 30px;font-size:15px;font-weight:600;letter-spacing:-.01em}
.mark{width:26px;height:26px;fill:var(--accent)}
.mark path{transform-box:fill-box;animation:settle .42s cubic-bezier(.3,1.35,.5,1) both}
.mark .s1{opacity:1}.mark .s2{opacity:.66;animation-delay:.08s}.mark .s3{opacity:.36;animation-delay:.16s}
@keyframes settle{from{transform:translateY(-6px);opacity:0}}
.badge{margin-left:auto;padding:2px 9px;border:1px solid var(--line);border-radius:999px;font-size:12px;font-weight:500;color:var(--muted)}
h1{margin:0 0 8px;font-size:24px;line-height:1.2;font-weight:650;letter-spacing:-.022em;text-wrap:balance;overflow-wrap:anywhere}
p{margin:0 0 22px;color:var(--muted);text-wrap:pretty}
strong{color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.host{font:13px/1.4 ${MONO};overflow-wrap:anywhere}
form{margin:0}
label{display:block;margin:0 0 6px;font-size:13px;font-weight:600}
label span{font-weight:400;color:var(--muted)}
input{display:block;width:100%;height:46px;margin:0 0 16px;padding:0 13px;font:inherit;font-size:16px;color:var(--ink);background:var(--field);border:1px solid var(--field-line);border-radius:10px;outline:none;transition:border-color .12s,box-shadow .12s}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--focus)}
button{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:48px;margin:6px 0 0;padding:0 18px;font:inherit;font-size:16px;font-weight:600;border-radius:10px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .07s,box-shadow .07s,background-color .12s}
.primary{color:var(--on-accent);background:var(--accent);border:1px solid transparent;box-shadow:inset 0 -2px 0 rgba(0,0,0,.2),0 1px 2px rgba(0,0,0,.14)}
.primary:hover{background:var(--accent-hi)}
.google{color:#1f1f1f;background:#fff;border:1px solid #747775;font-weight:500;box-shadow:inset 0 -2px 0 rgba(0,0,0,.07)}
.google:hover{background:#f6f7f7}
.google svg{width:18px;height:18px;flex:none}
@media (prefers-color-scheme:dark){.google{color:#e3e3e3;background:#131314;border-color:#8e918f;box-shadow:inset 0 -2px 0 rgba(255,255,255,.05)}.google:hover{background:#1c1c1e}}
button:active{transform:translateY(1px);box-shadow:inset 0 -1px 0 rgba(0,0,0,.2)}
button:focus-visible{outline:none;box-shadow:0 0 0 3px var(--focus)}
.note{margin:18px 0 0;font-size:13px}
code{padding:1px 5px;font:12.5px ${MONO};color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:5px}
pre{margin:0;padding:12px 14px;font:13px/1.75 ${MONO};color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;overflow-x:auto}
pre i{font-style:normal;color:var(--muted);user-select:none;-webkit-user-select:none}
ul{margin:0;padding:0;list-style:none;border:1px solid var(--line);border-radius:12px;overflow:hidden}
li+li{border-top:1px solid var(--line)}
li a{display:flex;align-items:center;gap:12px;min-height:58px;padding:10px 14px;color:inherit;text-decoration:none;transition:background-color .12s}
li a:hover{background:var(--bg)}
li b{display:block;font-weight:600;overflow-wrap:anywhere}
li small{display:block;font:12px/1.4 ${MONO};color:var(--muted);overflow-wrap:anywhere}
.dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--muted)}
.dot.running{background:#3c9a66;box-shadow:0 0 0 3px rgba(60,154,102,.18)}
.dot.restarting{background:#cf972b;box-shadow:0 0 0 3px rgba(207,151,43,.18)}
.dot.crashed{background:#d0533f;box-shadow:0 0 0 3px rgba(208,83,63,.18)}
.state{margin-left:auto;padding-left:8px;font-size:12.5px;color:var(--muted)}
@media (max-width:480px){body{justify-content:flex-start;padding-top:max(9vh,calc(env(safe-area-inset-top) + 24px))}main{max-width:none;padding:0 6px;background:none;border:0;border-radius:0;box-shadow:none}h1{font-size:27px}.brand{margin-bottom:36px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
export interface AuthPage {
  /** Document title; " · Bedrock" is appended. */
  title: string;
  /** Trusted HTML: escape every interpolated value. */
  heading: string;
  body: string;
  badge?: string;
}
export function authPage(page: AuthPage) {
  const badge = page.badge ? `<span class="badge">${page.badge}</span>` : "";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f3f1eb" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#101211" media="(prefers-color-scheme: dark)"><title>${page.title} · Bedrock</title><style>${STYLE}</style></head><body><main><div class="brand">${MARK}<span>bedrock</span>${badge}</div><h1>${page.heading}</h1>${page.body}</main></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "referrer-policy": "same-origin" },
  });
}
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
