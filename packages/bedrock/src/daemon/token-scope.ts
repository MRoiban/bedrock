import { BedrockError } from "../error";

export const deployActions = ["deploy", "lifecycle", "logs", "secrets", "status", "service-tokens"] as const;
export interface TokenScope { pebbles: string[]; actions: string[] }
export function validateTokenScope(input: unknown): TokenScope | null {
  if (input === undefined || input === null) return null;
  const scope = input as TokenScope;
  if (!Array.isArray(scope.pebbles) || !scope.pebbles.length || scope.pebbles.some(glob => typeof glob !== "string" || !/^[a-z0-9*?-]{1,64}$/.test(glob)) ||
      !Array.isArray(scope.actions) || !scope.actions.length || scope.actions.some(action => !deployActions.includes(action as typeof deployActions[number])))
    throw new BedrockError("INVALID_ARGS", "Invalid deploy token scope.", "Supply nonempty pebbles globs and actions: deploy,lifecycle,logs,secrets,status,service-tokens.");
  return { pebbles: [...new Set(scope.pebbles)], actions: [...new Set(scope.actions)] };
}
export function matchesPebble(scope: TokenScope, name: string) {
  return scope.pebbles.some(glob => new RegExp(`^${glob.replaceAll("*", ".*").replaceAll("?", ".")}$`).test(name));
}
export function authorizeScope(scope: TokenScope | null, request: Request) {
  if (!scope) return;
  const url = new URL(request.url);
  let action: string | undefined;
  let name: string | undefined;
  if (request.method === "GET" && ["/api/status", "/api/pebbles"].includes(url.pathname)) action = "status";
  else if (request.method === "POST" && url.pathname === "/api/deploy") { action = "deploy"; name = url.searchParams.get("name") ?? ""; }
  else {
    const match = /^\/api\/pebbles\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (match) {
      name = match[1]!;
      const endpoint = match[2];
      if (endpoint === "secrets" && ["GET", "PUT"].includes(request.method)) action = "secrets";
      else if (endpoint === "service-tokens" && request.method === "POST" || endpoint?.startsWith("service-tokens/") && request.method === "DELETE") action = "service-tokens";
      else if (endpoint === "logs" && request.method === "GET") action = "logs";
      else if (endpoint && ["start", "stop", "restart", "rollback"].includes(endpoint) && request.method === "POST" || !endpoint && request.method === "DELETE") action = "lifecycle";
    }
  }
  if (!action || !scope.actions.includes(action) || name !== undefined && !matchesPebble(scope, name))
    throw new BedrockError("FORBIDDEN", "The deploy token scope does not grant this operation.", `Use a creator token or grant ${action ?? "an unscoped token"}${name !== undefined ? ` for pebble ${name}` : ""}.`);
}
