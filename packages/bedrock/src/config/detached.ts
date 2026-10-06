import type { DetachedRouteDefinition } from "./types";
import { BedrockError } from "../error";

export function detached(handler: DetachedRouteDefinition["run"]): DetachedRouteDefinition {
  if (typeof handler !== "function") throw new BedrockError("INVALID_ROUTE", "Detached route handler is missing.", "Use detached(async (request, server, ctx) => new Response(...)).");
  return { transaction: false, run: handler };
}
