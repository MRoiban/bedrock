import type { FunctionArgs, FunctionResult, FunctionDefinition, PebbleConfig, QueryNames, MutationNames, User } from "../config/types";
import type { BedrockError } from "../error";

// The wire is JSON: timestamps become strings and void results become null.
export type JsonResult<T> = T extends Date ? string
  : T extends readonly unknown[] ? { [K in keyof T]: JsonResult<T[K]> }
  : T extends object ? { [K in keyof T]: JsonResult<T[K]> }
  : T extends void ? null : T;
export type ClientResult<F extends FunctionDefinition> = JsonResult<FunctionResult<F>>;

type Queries<P extends PebbleConfig> = NonNullable<P["queries"]>;
type Mutations<P extends PebbleConfig> = NonNullable<P["mutations"]>;
export interface Client<P extends PebbleConfig = PebbleConfig> {
  query<N extends QueryNames<P>>(name: N, args: FunctionArgs<Queries<P>[N]>): Promise<ClientResult<Queries<P>[N]>>;
  mutate<N extends MutationNames<P>>(name: N, args: FunctionArgs<Mutations<P>[N]>): Promise<ClientResult<Mutations<P>[N]>>;
  subscribe<N extends QueryNames<P>>(name: N, args: FunctionArgs<Queries<P>[N]>, onData: (data: ClientResult<Queries<P>[N]>) => void, onError?: (error: BedrockError) => void): () => void;
  user(): Promise<User | null>;
  loginUrl(returnTo?: string): string;
  logout(): Promise<void>;
  upload(bucket: import("../config/types").BucketNames<P>, file: File, options?: import("./storage").UploadOptions): Promise<import("../config/types").FileMetadata>;
  fileUrl(bucket: import("../config/types").BucketNames<P>, id: string): string;
  deleteFile(bucket: import("../config/types").BucketNames<P>, id: string): Promise<void>;
  close(): void;
}
export interface ClientOptions {
  url?: string;
  sync?: boolean;
  /** Extra HTTP headers. WebSocket identity normally comes from session cookies. */
  headers?: HeadersInit;
}
