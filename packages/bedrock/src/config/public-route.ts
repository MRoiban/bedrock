import { BedrockError } from "../error";
import type { DetachedRouteDefinition, RouteHandler } from "./types";

const publicMarker = Symbol.for("bedrock.publicRoute");
export function isPublicRoute(value: unknown): boolean {
  return !!value && (typeof value === "object" || typeof value === "function") && (value as Record<symbol, unknown>)[publicMarker] === true;
}

export function publicRoute<H extends RouteHandler>(handler: H): H;
export function publicRoute(handler: DetachedRouteDefinition): DetachedRouteDefinition;
export function publicRoute(handler: RouteHandler | DetachedRouteDefinition): RouteHandler | DetachedRouteDefinition {
  if (typeof handler === "function") return Object.assign((...args: Parameters<RouteHandler>) => handler(...args), { [publicMarker]: true });
  if (handler?.transaction === false && typeof handler.run === "function" && Object.keys(handler).every(key => key === "transaction" || key === "run")) return Object.assign({ ...handler }, { [publicMarker]: true });
  throw new BedrockError("INVALID_PUBLIC_ROUTE", "Only HTTP route handlers can be public.", "Use publicRoute(handler) or publicRoute(detached(handler)) inside routes.");
}

export function publicRouteKeys(routes: Record<string, unknown> = {}) {
  return Object.entries(routes).filter(([, handler]) => isPublicRoute(handler)).map(([key]) => key);
}

export function validatePublicRouteKey(key: string) {
  const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/[^?#*\\\s]*)$/.exec(key);
  const path = match?.[2];
  if (!path || path.includes("//") || new URL(path, "http://localhost").pathname !== path || path === "/_bedrock" || path.startsWith("/_bedrock/"))
    throw new BedrockError("INVALID_PUBLIC_ROUTE", `Invalid public route: ${key}`, "Use METHOD /path outside /_bedrock; public paths must be normalized, without wildcards or repeated slashes.");
}
