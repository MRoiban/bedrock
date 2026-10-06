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
export function authPage(content: string) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Bedrock</title><style>body{font:17px system-ui;background:#f6f5ef;color:#27372e;max-width:420px;margin:12vh auto;padding:24px}h1{font-size:36px}label{display:block;margin:18px 0 6px}input,button{font:inherit;padding:12px;border:1px solid #a2afa5;border-radius:6px;box-sizing:border-box;width:100%}button{background:#214a36;color:white;margin-top:24px;cursor:pointer}a{color:#214a36}</style><h1>Welcome to Bedrock</h1>${content}</html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "referrer-policy": "same-origin" },
  });
}
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
