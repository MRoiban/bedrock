import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FunctionContext, FunctionDefinition } from "./types";
import { BedrockError } from "../error";

type Handler<A, R> = (ctx: FunctionContext, args: A) => R;
type MutationOptions<S extends StandardSchemaV1, R> = {
  args: S;
  idempotencyKey?: (args: StandardSchemaV1.InferOutput<S>) => string | null | undefined;
  run: Handler<StandardSchemaV1.InferOutput<S>, R>;
};

const invalidFunction = () => new BedrockError("INVALID_FUNCTION", "Expected a handler, Standard Schema and handler, or mutation options.", "Use query(fn), query(schema, fn), mutation(fn), mutation(schema, fn), or mutation({ args, idempotencyKey, run }).");

function defineFunction(kind: "query" | "mutation", schemaOrFn: StandardSchemaV1 | Handler<any, any>, fn?: Handler<any, any>): FunctionDefinition {
  if (typeof schemaOrFn === "function" && fn === undefined) return { kind, run: schemaOrFn };
  if (typeof fn !== "function" || !schemaOrFn || typeof schemaOrFn === "function" ||
      schemaOrFn["~standard"]?.version !== 1 || typeof schemaOrFn["~standard"].validate !== "function") {
    throw invalidFunction();
  }
  return { kind, schema: schemaOrFn, run: fn };
}

export function query<R>(fn: Handler<void, R>): FunctionDefinition<void, R>;
export function query<S extends StandardSchemaV1, R>(schema: S, fn: Handler<StandardSchemaV1.InferOutput<S>, R>): FunctionDefinition<StandardSchemaV1.InferOutput<S>, R, StandardSchemaV1.InferInput<S>>;
export function query(schemaOrFn: StandardSchemaV1 | Handler<any, any>, fn?: Handler<any, any>): FunctionDefinition {
  return defineFunction("query", schemaOrFn, fn);
}

export function mutation<R>(fn: Handler<void, R>): FunctionDefinition<void, R>;
export function mutation<S extends StandardSchemaV1, R>(schema: S, fn: Handler<StandardSchemaV1.InferOutput<S>, R>): FunctionDefinition<StandardSchemaV1.InferOutput<S>, R, StandardSchemaV1.InferInput<S>>;
export function mutation<S extends StandardSchemaV1, R>(options: MutationOptions<S, R>): FunctionDefinition<StandardSchemaV1.InferOutput<S>, R, StandardSchemaV1.InferInput<S>>;
export function mutation(schemaOrFn: StandardSchemaV1 | Handler<any, any> | MutationOptions<StandardSchemaV1, any>, fn?: Handler<any, any>): FunctionDefinition {
  if (schemaOrFn && typeof schemaOrFn === "object" && !Array.isArray(schemaOrFn) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(schemaOrFn)) &&
      !("~standard" in schemaOrFn) && "run" in schemaOrFn && typeof schemaOrFn.run === "function") {
    if (fn !== undefined || "idempotencyKey" in schemaOrFn && typeof schemaOrFn.idempotencyKey !== "function") throw invalidFunction();
    const definition = defineFunction("mutation", schemaOrFn.args, schemaOrFn.run);
    return { ...definition, ...(schemaOrFn.idempotencyKey ? { idempotencyKey: schemaOrFn.idempotencyKey } : {}) };
  }
  return defineFunction("mutation", schemaOrFn as StandardSchemaV1 | Handler<any, any>, fn);
}
