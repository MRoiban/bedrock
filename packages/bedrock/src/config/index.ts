import { socketSize } from "./hosting";
import { validateDirectories } from "../backup/directories";
import { validateBucket, validateBuckets } from "../storage/config";
import { is, Table, getTableName } from "drizzle-orm";
import { BedrockError } from "../error";
import type { Bucket, BucketConfig, PebbleConfig } from "./types";

export { job } from "../jobs";
import { parseCron } from "../jobs/cron";

export * from "./hosting";
export { detached } from "./detached";
export { query, mutation } from "./functions";
export type * from "./types";

export function validateName(name: string) {
  if (typeof name !== "string" || !/^[a-z0-9-]{1,32}$/.test(name) || ["auth", "bedrock", "www"].includes(name)) {
    throw new BedrockError("INVALID_PEBBLE_NAME", `Invalid pebble name: ${name}`, "Use 1–32 lowercase letters, digits, or hyphens; auth, bedrock, and www are reserved.");
  }
  if (process.platform === "win32" && /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name)) throw new BedrockError("INVALID_PEBBLE_NAME", `${name} is a reserved Windows device name.`, "Choose a different pebble name, such as my-app.");
}

const validated = new WeakSet<object>();

export function definePebble<const P extends PebbleConfig>(config: P): P {
  if (!config || typeof config !== "object") {
    throw new BedrockError("INVALID_CONFIG", "Expected a pebble configuration object.", "Default-export definePebble({ name, queries, mutations, ... }) from pebble.ts.");
  }
  if ("plugins" in config) throw new BedrockError("INVALID_CONFIG", "Plugins are no longer supported.", "Plugins were removed; spread the plugin's schema/routes/jobs/sockets/services objects into definePebble directly.");
  if (validated.has(config)) return config;
  validateName(config.name);
  if (config.maxRequestBodySize !== undefined && (!Number.isSafeInteger(config.maxRequestBodySize) || config.maxRequestBodySize <= 0 || config.maxRequestBodySize > 1024 ** 4)) throw new BedrockError("INVALID_CONFIG", "Invalid maxRequestBodySize.", "Use a positive integer byte limit up to 1 TiB; stream custom request bodies.");
  validateBuckets(config.storage);
  for (const [path, definition] of Object.entries(config.sockets ?? {})) {
    if (!/^\/[^?#]*$/.test(path) || path === "/_bedrock" || path.startsWith("/_bedrock/") || !definition || typeof definition.message !== "function" || [definition.open, definition.close, definition.drain].some(fn => fn !== undefined && typeof fn !== "function")) throw new BedrockError("INVALID_SOCKET", `Invalid socket: ${path}`, "Use socket({ message }) at an absolute path outside /_bedrock.");
    if (definition.maxMessageSize !== undefined) socketSize(definition.maxMessageSize);
    if (definition.backpressureLimit !== undefined) socketSize(definition.backpressureLimit);
  }
  for (const [name, definition] of Object.entries(config.services ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || ["constructor", "prototype", "__proto__"].includes(name) || !definition || typeof definition.start !== "function" || definition.stop !== undefined && typeof definition.stop !== "function") throw new BedrockError("INVALID_SERVICE", `Invalid service: ${name}`, "Use a letter-led name and service({ start, stop? }).");
    if (definition.stopTimeout !== undefined && (!Number.isSafeInteger(definition.stopTimeout) || definition.stopTimeout <= 0)) throw new BedrockError("INVALID_SERVICE", `Invalid stopTimeout for ${name}.`, "Use a positive integer in milliseconds; the shared service deadline is capped at 30000 ms.");
  }
  validateDirectories(config.backup);
  const tableNames = new Set<string>();
  for (const table of Object.values(config.schema ?? {})) if (is(table, Table)) {
    const name = getTableName(table);
    if (tableNames.has(name)) throw new BedrockError("DUPLICATE_TABLE", `Duplicate SQL table: ${name}`, "Give each table in schema a distinct SQL name; register each table only once.");
    tableNames.add(name);
  }
  for (const [name, definition] of Object.entries(config.jobs ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || ["constructor", "prototype", "__proto__"].includes(name) || typeof definition.run !== "function") throw new BedrockError("INVALID_JOB", `Invalid job: ${name}`, "Use a unique letter-led name and job(cron, handler).");
    parseCron(definition.cron);
  }
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
  const result = { ...config };
  validated.add(result);
  return result;
}

export function bucket<const N extends string>(name: N, config: BucketConfig): Bucket<N> {
  const value = { ...config, name };
  validateBucket(value);
  return value;
}
