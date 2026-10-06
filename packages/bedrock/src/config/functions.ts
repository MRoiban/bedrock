import { validateBuckets } from "../storage/config";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { BucketConfig, FunctionContext, FunctionDefinition } from "./types";
import { BedrockError } from "../error";

type Handler<A, R, S = {}> = (ctx: FunctionContext<S>, args: A) => R;

function defineFunction(kind: "query" | "mutation", schemaOrFn: StandardSchemaV1 | Handler<any, any>, fn?: Handler<any, any>): FunctionDefinition {
  if (typeof schemaOrFn === "function" && fn === undefined) return { kind, run: schemaOrFn };
  if (typeof fn !== "function" || !schemaOrFn || typeof schemaOrFn === "function" ||
      schemaOrFn["~standard"]?.version !== 1 || typeof schemaOrFn["~standard"].validate !== "function") {
    throw new BedrockError("INVALID_FUNCTION", "Expected a handler or Standard Schema and handler.", "Use query(fn), query(schema, fn), mutation(fn), or mutation(schema, fn).");
  }
  return { kind, schema: schemaOrFn, run: fn };
}

export function query<const B extends Record<string, BucketConfig>, R>(storage: B, fn: Handler<void, R, B>): FunctionDefinition<void, R>;
export function query<const B extends Record<string, BucketConfig>, S extends StandardSchemaV1, R>(storage: B, schema: S, fn: Handler<StandardSchemaV1.InferOutput<S>, R, B>): FunctionDefinition<StandardSchemaV1.InferOutput<S>, R, StandardSchemaV1.InferInput<S>>;
export function query<R>(fn: Handler<void, R>): FunctionDefinition<void, R>;
export function query<S extends StandardSchemaV1, R>(schema: S, fn: Handler<StandardSchemaV1.InferOutput<S>, R>): FunctionDefinition<StandardSchemaV1.InferOutput<S>, R, StandardSchemaV1.InferInput<S>>;
export function query(schemaOrFn: any, fn?: any, handler?: any): FunctionDefinition {
  if (handler) { validateBuckets(schemaOrFn); return defineFunction("query", fn, handler); }
  if (schemaOrFn && typeof schemaOrFn === "object" && !("~standard" in schemaOrFn) && fn) { validateBuckets(schemaOrFn); return defineFunction("query", fn); }
  return defineFunction("query", schemaOrFn, fn);
}

export function mutation<const B extends Record<string, BucketConfig>, R>(storage: B, fn: Handler<void, R, B>): FunctionDefinition<void, R>;
export function mutation<const B extends Record<string, BucketConfig>, S extends StandardSchemaV1, R>(storage: B, schema: S, fn: Handler<StandardSchemaV1.InferOutput<S>, R, B>): FunctionDefinition<StandardSchemaV1.InferOutput<S>, R, StandardSchemaV1.InferInput<S>>;
export function mutation<R>(fn: Handler<void, R>): FunctionDefinition<void, R>;
export function mutation<S extends StandardSchemaV1, R>(schema: S, fn: Handler<StandardSchemaV1.InferOutput<S>, R>): FunctionDefinition<StandardSchemaV1.InferOutput<S>, R, StandardSchemaV1.InferInput<S>>;
export function mutation(schemaOrFn: any, fn?: any, handler?: any): FunctionDefinition {
  if (handler) { validateBuckets(schemaOrFn); return defineFunction("mutation", fn, handler); }
  if (schemaOrFn && typeof schemaOrFn === "object" && !("~standard" in schemaOrFn) && fn) { validateBuckets(schemaOrFn); return defineFunction("mutation", fn); }
  return defineFunction("mutation", schemaOrFn, fn);
}
