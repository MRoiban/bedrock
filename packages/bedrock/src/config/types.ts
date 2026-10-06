import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export interface User {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export interface FunctionContext<S = Record<string, BucketConfig>> {
  db: BunSQLiteDatabase<Record<string, unknown>>;
  user: User | null;
  pebble: { readonly name: string };
  storage: import("../storage").StorageFor<S>;
  request: Request;
}

export interface FunctionDefinition<Args = any, Result = any, Input = Args> {
  readonly kind: "query" | "mutation";
  readonly schema?: StandardSchemaV1<Input, Args>;
  readonly run: (ctx: FunctionContext, args: Args) => Result;
}

export type FunctionMap = Record<string, FunctionDefinition>;
export type Access = "public" | "users" | "creators" | { allow: readonly string[] };
export type RouteHandler = (request: Request, server: Bun.Server<undefined>) => Response | Promise<Response>;

export interface FileMetadata {
  id: string;
  bucket: string;
  sha256: string;
  createdAt: number;
  ownerId: string | null;
  name: string;
  mime: string;
  size: number;
}
export interface BucketConfig {
  maxSize: string | number;
  access: "public" | "users" | "owner" | ((ctx: FunctionContext, file: FileMetadata) => boolean | Promise<boolean>);
  accept?: readonly string[];
}

export interface PluginConfig {
  name: string;
  schema?: Record<string, unknown>;
  routes?: Record<string, RouteHandler>;
  onQuery?: (ctx: FunctionContext, name: string, args: unknown, next: () => Promise<unknown>) => Promise<unknown>;
  onMutation?: PluginConfig["onQuery"];
  jobs?: Record<string, { cron: string; run: (ctx: FunctionContext) => unknown }>;
}

export interface PebbleConfig<Q extends FunctionMap = FunctionMap, M extends FunctionMap = FunctionMap> {
  name: string;
  access?: Access;
  schema?: Record<string, unknown>;
  queries?: Q;
  mutations?: M;
  storage?: Record<string, BucketConfig>;
  sync?: boolean;
  web?: string;
  routes?: Record<string, RouteHandler>;
  plugins?: readonly PluginConfig[];
}

export type FunctionArgs<F extends FunctionDefinition> = F extends FunctionDefinition<any, any, infer Input> ? Input : never;
export type FunctionResult<F extends FunctionDefinition> = F extends FunctionDefinition<any, infer R> ? Awaited<R> : never;
export type QueryNames<P extends PebbleConfig> = keyof NonNullable<P["queries"]> & string;
export type MutationNames<P extends PebbleConfig> = keyof NonNullable<P["mutations"]> & string;
