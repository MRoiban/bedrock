import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FunctionContext, FunctionDefinition } from "./types";
import { BedrockError } from "../error";

type Handler<A, R> = (ctx: FunctionContext, args: A) => R;

function defineFunction(kind: "query" | "mutation", schemaOrFn: StandardSchemaV1 | Handler<any, any>, fn?: Handler<any, any>): FunctionDefinition {
  if (typeof schemaOrFn === "function" && fn === undefined) return { kind, run: schemaOrFn };
  if (typeof fn !== "function" || !schemaOrFn || typeof schemaOrFn === "function" ||
      schemaOrFn["~standard"]?.version !== 1 || typeof schemaOrFn["~standard"].validate !== "function") {
    throw new BedrockError("INVALID_FUNCTION", "Expected a handler or Standard Schema and handler.", "Use query(fn), query(schema, fn), mutation(fn), or mutation(schema, fn).");
  }
  return { kind, schema: schemaOrFn, run: fn };
}

export function query<R>(fn: Handler<void, R>): FunctionDefinition<void, R>;
export function query<S extends StandardSchemaV1, R>(schema: S, fn: Handler<StandardSchemaV1.InferOutput<S>, R>): FunctionDefinition<StandardSchemaV1.InferOutput<S>, R>;
export function query(schemaOrFn: StandardSchemaV1 | Handler<any, any>, fn?: Handler<any, any>): FunctionDefinition {
  return defineFunction("query", schemaOrFn, fn);
}

export function mutation<R>(fn: Handler<void, R>): FunctionDefinition<void, R>;
export function mutation<S extends StandardSchemaV1, R>(schema: S, fn: Handler<StandardSchemaV1.InferOutput<S>, R>): FunctionDefinition<StandardSchemaV1.InferOutput<S>, R>;
export function mutation(schemaOrFn: StandardSchemaV1 | Handler<any, any>, fn?: Handler<any, any>): FunctionDefinition {
  return defineFunction("mutation", schemaOrFn, fn);
}
