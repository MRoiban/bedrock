import { BedrockError, asBedrockError } from "../error";
import type { ClientOptions } from "./types";
import { remoteError, wireArgs } from "./wire";

export function httpClient(base: URL, options: ClientOptions, hooks: {
  closed: () => boolean;
  received: (response: Response) => void;
  offline: () => void;
}) {
  async function request(path: string | URL, init: RequestInit = {}, code = "REQUEST_FAILED") {
    if (hooks.closed()) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
    const headers = new Headers(options.headers);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (options.token) { headers.set("authorization", `Bearer ${options.token}`); headers.delete("cookie"); }
    headers.set("origin", base.origin);
    let response: Response;
    try { response = await fetch(new URL(path, base), { ...init, headers, credentials: options.token ? "omit" : "include", signal: init.signal ?? AbortSignal.timeout(30_000) }); }
    catch (error) { hooks.offline(); throw asBedrockError(error, code, "Check your network connection and pebble URL."); }
    hooks.received(response);
    return response;
  }
  async function http(kind: "q" | "m", name: string, args: unknown, idempotencyKey?: string) {
    if (hooks.closed()) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
      const body = JSON.stringify(wireArgs(args));
      const attempts = kind === "m" && idempotencyKey ? 3 : 1;
      for (let attempt = 1; ; attempt++) {
        let response: Response, result: any;
        try {
          response = await request(`/_bedrock/${kind}/${encodeURIComponent(name)}`, { method: "POST", headers, body });
          result = await response.json();
        } catch (error) {
          if (attempt >= attempts || hooks.closed()) throw error;
          await new Promise(resolve => setTimeout(resolve, 250 * attempt));
          continue;
        }
        if (!result.ok) throw remoteError(result.error, response.status);
        return result.value;
      }
    } catch (error) { throw asBedrockError(error, "REQUEST_FAILED", "Check your network connection and pebble URL."); }
  }
  async function authRequest(path: string, method = "GET", networkCode = "REQUEST_FAILED") {
    if (hooks.closed()) throw new BedrockError("CLIENT_CLOSED", "The client is closed.", "Create a new client.");
    try {
      const response = await request(path, { method }, networkCode);
      const result = await response.json();
      if (!response.ok) throw remoteError(result.error, response.status);
      return result;
    } catch (error) { throw asBedrockError(error, "REQUEST_FAILED", "Check your network connection and pebble URL."); }
  }
  return { request, http, authRequest };
}
