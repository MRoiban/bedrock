import { is, Table, getTableName } from "drizzle-orm";
import { BedrockError } from "../error";
import type { BucketConfig, PebbleConfig, PluginConfig } from "./types";

export { query, mutation } from "./functions";
export type * from "./types";

export function validateName(name: string) {
  if (typeof name !== "string" || !/^[a-z0-9-]{1,32}$/.test(name) || ["auth", "bedrock", "www"].includes(name)) {
    throw new BedrockError("INVALID_PEBBLE_NAME", `Invalid pebble name: ${name}`, "Use 1–32 lowercase letters, digits, or hyphens; auth, bedrock, and www are reserved.");
  }
}

export function definePebble<const P extends PebbleConfig>(config: P): P {
  if (!config || typeof config !== "object") {
    throw new BedrockError("INVALID_CONFIG", "Expected a pebble configuration object.", "Default-export definePebble({ name, queries, mutations, ... }) from pebble.ts.");
  }
  validateName(config.name);
  for (const [kind, functions] of [["query", config.queries], ["mutation", config.mutations]] as const) {
    for (const [name, definition] of Object.entries(functions ?? {})) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || ["constructor", "prototype", "__proto__"].includes(name)) {
        throw new BedrockError("INVALID_FUNCTION_NAME", `Invalid function name: ${name}`, "Use a letter followed by letters, digits, or underscores; avoid prototype property names.");
      }
      if (!definition || definition.kind !== kind || typeof definition.run !== "function") {
        throw new BedrockError("INVALID_FUNCTION", `Invalid ${kind}: ${name}`, `Define it using ${kind}(handler) or ${kind}(schema, handler).`);
      }
    }
  }
  for (const table of Object.values(config.schema ?? {})) {
    if (is(table, Table) && getTableName(table).startsWith("_bedrock_")) {
      throw new BedrockError("RESERVED_TABLE", "Table names starting with _bedrock_ are reserved.", "Rename the table in the schema and migrations.");
    }
  }
  return config;
}

export function bucket<const T extends BucketConfig>(config: T): T { return config; }
export function plugin<const T extends PluginConfig>(config: T): T { return config; }
