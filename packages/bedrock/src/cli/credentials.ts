import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir, hostname } from "node:os";
import { atomicWrite } from "../daemon/config";
import { BedrockError } from "../error";
import { randomToken } from "../auth/sessions";

export interface Credentials { url: string; token: string }
export const credentialsPath = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "bedrock/credentials.json");
export function remoteUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new BedrockError("INVALID_REMOTE_URL", "Invalid remote daemon URL.", "Use https://bedrock.<domain>."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new BedrockError("INVALID_REMOTE_URL", "Remote login requires an HTTPS origin.", "Use https://bedrock.<domain> without a path or embedded credentials.");
  return url.origin;
}
export async function readCredentials(path = credentialsPath()): Promise<Credentials | null> {
  if (!await Bun.file(path).exists()) return null;
  try {
    const value = await Bun.file(path).json();
    if (!/^br_[a-f0-9]{64}$/.test(value.token)) throw new Error("invalid token");
    return { url: remoteUrl(value.url), token: value.token };
  } catch { throw new BedrockError("INVALID_CREDENTIALS", "Saved CLI credentials are invalid.", "Remove the credentials file and run bedrock login --url https://bedrock.<domain> again."); }
}
export async function saveCredentials(value: Credentials, path = credentialsPath()) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await atomicWrite(path, JSON.stringify(value) + "\n");
}
export function browserCommand(url: string, platform = process.platform) {
  if (platform === "win32") return ["rundll32.exe", "url.dll,FileProtocolHandler", url];
  return platform === "darwin" ? ["open", url] : ["xdg-open", url];
}
export async function openBrowser(url: string) {
  const args = browserCommand(url);
  try {
    const child = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
    if (await child.exited !== 0) throw new Error("browser failed");
  } catch { console.error(`Open this URL in your browser: ${url}`); }
}
export function loginCallback(state: string, complete: (token: string) => void) {
  let consumed = false;
  return (request: Request) => {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/callback") return new Response("Not found", { status: 404 });
    if (consumed || url.searchParams.get("state") !== state) return new Response("Invalid CLI login state. Restart bedrock login.", { status: 400 });
    const token = url.searchParams.get("token") ?? "";
    if (!/^br_[a-f0-9]{64}$/.test(token)) return new Response("Invalid deploy token.", { status: 400 });
    consumed = true;
    complete(token);
    return new Response("CLI authorized. You can close this tab.", { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'", "content-type": "text/plain" } });
  };
}
export function loginUrl(value: string) {
  if (!value.includes("://")) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/i.test(value)) throw new BedrockError("INVALID_REMOTE_URL", "Invalid daemon domain.", "Use example.com, bedrock.example.com or an HTTPS URL.");
    value = value.toLowerCase();
    value = `https://${value.startsWith("bedrock.") ? value : `bedrock.${value}`}`;
  } else {
    const parsed = new URL(remoteUrl(value));
    if (!parsed.hostname.startsWith("bedrock.")) parsed.hostname = `bedrock.${parsed.hostname}`;
    value = parsed.origin;
  }
  return remoteUrl(value);
}
export async function login(url: string, options: { path?: string; open?: (url: string) => Promise<void>; timeout?: number; fetch?: typeof fetch } = {}) {
  url = loginUrl(url);
  const existing = await readCredentials(options.path);
  if (existing && existing.url !== url) throw new BedrockError("LOGIN_CONFLICT", "The CLI is already signed in to another server.", "Run bedrock logout before logging in to a different server.");
  if (existing) {
    let response: Response;
    try { response = await (options.fetch ?? fetch)(`${url}/api/status`, { headers: { authorization: `Bearer ${existing.token}` }, redirect: "error", signal: AbortSignal.timeout(10000) }); }
    catch { throw new BedrockError("LOGIN_FAILED", "Could not verify existing credentials.", "Check your internet connection and retry; existing credentials are retained."); }
    if (response.ok) return { command: "login", url, authenticated: true };
    if (response.status !== 401) throw new BedrockError("LOGIN_FAILED", "The daemon could not verify existing credentials.", "Check the daemon and retry login.");
  }
  const state = randomToken();
  let complete!: (token: string) => void;
  const result = new Promise<string>(resolve => { complete = resolve; });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: loginCallback(state, complete) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const authorize = new URL("/cli-login", url);
    authorize.searchParams.set("port", String(server.port));
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("hostname", hostname());
    await (options.open ?? openBrowser)(authorize.toString());
    const token = await Promise.race([result, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BedrockError("LOGIN_TIMEOUT", "CLI login timed out.", "Run bedrock login again and authorize it in your browser.")), options.timeout ?? 300000); })]);
    await saveCredentials({ url, token }, options.path);
    return { command: "login", url, authenticated: true };
  } finally { clearTimeout(timer); await server.stop(true); }
}
export async function logout(path = credentialsPath(), fetcher: typeof fetch = fetch) {
  const credentials = await readCredentials(path);
  if (!credentials) return { command: "logout", loggedOut: true };
  let response: Response;
  try { response = await fetcher(`${credentials.url}/api/tokens/current`, { method: "DELETE", headers: { authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.timeout(10000), redirect: "error" }); }
  catch { throw new BedrockError("LOGOUT_FAILED", "Could not revoke the remote deploy token.", "Check your connection and retry logout; credentials are retained so revocation can be retried."); }
  if (!response.ok && response.status !== 401) throw new BedrockError("LOGOUT_FAILED", "The daemon could not revoke this token.", "Retry logout after checking the daemon; credentials have been retained.");
  await rm(path, { force: true });
  return { command: "logout", loggedOut: true };
}
