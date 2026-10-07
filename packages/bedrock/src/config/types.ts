import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export interface User {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export interface TokenIdentity { id: string; name: string; permissions: string[] }
export interface TokenMetadata extends TokenIdentity { createdAt: number; lastUsedAt: number | null; expiresAt: number | null }
export interface TokenApi {
  create(input: { name: string; permissions: string[]; expiresAt?: number }): TokenIdentity & { token: string; createdAt: number; expiresAt: number | null };
  list(): TokenMetadata[];
  revoke(id: string): void;
}

export interface FunctionContext<S = import("./hosting").ServiceValues> {
  services: S;
  db: BunSQLiteDatabase<Record<string, unknown>> & { $client: import("bun:sqlite").Database };
  user: User | null;
  readonly token: TokenIdentity | null;
  pebble: { readonly name: string };
  tokens: TokenApi;
  storage: import("../storage").Storage;
  request: Request;
  invalidate: (tables: readonly (string | SQLiteTable)[]) => void;
}

export interface DetachedContext<S = import("./hosting").ServiceValues> {
  services: S;
  user: User | null;
  readonly token: TokenIdentity | null;
  pebble: { readonly name: string };
  request: Request;
  read: <R>(fn: (ctx: FunctionContext<S>) => R) => Promise<Awaited<R>>;
  write: <R>(fn: (ctx: FunctionContext<S>) => R) => Promise<Awaited<R>>;
}

export interface FunctionDefinition<Args = any, Result = any, Input = Args> {
  readonly kind: "query" | "mutation";
  readonly schema?: StandardSchemaV1<Input, Args>;
  readonly run: (ctx: FunctionContext, args: Args) => Result;
}

export type FunctionMap = Record<string, FunctionDefinition>;
export type Access = "public" | "users" | "creators" | { allow: readonly string[] };
export type RouteHandler = (request: Request, server: Bun.Server<undefined>, ctx: FunctionContext) => Response | Promise<Response>;

export interface DetachedRouteDefinition {
  readonly transaction: false;
  readonly run: (request: Request, server: Bun.Server<undefined>, ctx: DetachedContext) => Response | Promise<Response>;
}

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
export interface UploadCandidate { bucket: string; name: string; mime: string; size: number | null; ownerId: string | null; meta: unknown }
export interface BucketConfig {
  maxSize: string | number;
  access: "public" | "users" | "owner" | ((ctx: FunctionContext, file: FileMetadata) => boolean | Promise<boolean>);
  accept?: readonly string[];
  admit?: (ctx: FunctionContext, candidate: UploadCandidate) => void | Promise<void>;
  onStored?: (ctx: FunctionContext, file: FileMetadata, meta: unknown) => void | Promise<void>;
}

export interface Bucket<Name extends string = string> extends BucketConfig {
  readonly name: Name;
}

export type BucketNames<P extends PebbleConfig> = NonNullable<P["storage"]>[number]["name"];

export interface TransactionalJobDefinition { cron: string; transaction?: true; run: (ctx: FunctionContext) => unknown }
export interface DetachedJobDefinition { cron: string; transaction: false; run: (ctx: DetachedContext) => unknown }
export type JobDefinition = TransactionalJobDefinition | DetachedJobDefinition;

export interface PluginConfig {
  name: string;
  schema?: Record<string, unknown>;
  sockets?: Record<string, import("./hosting").SocketDefinition>;
  services?: Record<string, import("./hosting").ServiceDefinition>;
  routes?: Record<string, RouteHandler | DetachedRouteDefinition>;
  onQuery?: (ctx: FunctionContext, name: string, args: unknown, next: () => Promise<unknown>) => Promise<unknown>;
  onMutation?: PluginConfig["onQuery"];
  jobs?: Record<string, JobDefinition>;
}

export interface PebbleConfig<Q extends FunctionMap = FunctionMap, M extends FunctionMap = FunctionMap> {
  name: string;
  access?: Access;
  schema?: Record<string, unknown>;
  queries?: Q;
  mutations?: M;
  storage?: readonly Bucket[];
  sync?: boolean;
  tokens?: boolean;
  backup?: import("./hosting").DirectoryBackup;
  web?: string;
  sockets?: Record<string, import("./hosting").SocketDefinition>;
  services?: Record<string, import("./hosting").ServiceDefinition>;
  routes?: Record<string, RouteHandler | DetachedRouteDefinition>;
  plugins?: readonly PluginConfig[];
  jobs?: Record<string, JobDefinition>;
}

export type FunctionArgs<F extends FunctionDefinition> = F extends FunctionDefinition<any, any, infer Input> ? Input : never;
export type FunctionResult<F extends FunctionDefinition> = F extends FunctionDefinition<any, infer R> ? Awaited<R> : never;
export type QueryNames<P extends PebbleConfig> = keyof NonNullable<P["queries"]> & string;
export type MutationNames<P extends PebbleConfig> = keyof NonNullable<P["mutations"]> & string;
