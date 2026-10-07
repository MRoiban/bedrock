import { createContext, createElement, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Client, ClientResult } from "../client";
import type { User, FunctionArgs, PebbleConfig, QueryNames, MutationNames } from "../config/types";
import { BedrockError, asBedrockError } from "../error";

const Context = createContext<Client | null>(null);
export function BedrockProvider<P extends PebbleConfig>({ client, children }: { client: Client<P>; children?: ReactNode }) {
  return createElement(Context.Provider, { value: client as Client }, children);
}
function useClient() {
  const client = useContext(Context);
  if (!client) throw new BedrockError("PROVIDER_REQUIRED", "Bedrock hooks need a BedrockProvider.", "Wrap your component in <BedrockProvider client={client}>.");
  return client;
}
function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, (_key, item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
      }
      return item;
    });
  } catch (error) {
    throw asBedrockError(error, "INVALID_ARGS", "Send JSON-serializable hook arguments.");
  }
}
export function useQuery<P extends PebbleConfig, N extends QueryNames<P> = QueryNames<P>>(name: N, args: FunctionArgs<NonNullable<P["queries"]>[N]>) {
  type Data = ClientResult<NonNullable<P["queries"]>[N]>;
  const client = useClient();
  const key = stableJson(args);
  const currentArgs = useRef(args);
  currentArgs.current = args;
  const [state, setState] = useState<{ data: Data | undefined; error: BedrockError | undefined; isLoading: boolean; key: string; name: string }>({ data: undefined, error: undefined, isLoading: true, key, name });
  useEffect(() => {
    let active = true;
    setState({ data: undefined, error: undefined, isLoading: true, key, name });
    const unsubscribe = client.subscribe(name, currentArgs.current, data => {
      if (active) setState({ data, error: undefined, isLoading: false, key, name });
    }, error => {
      if (active) setState(previous => ({ ...previous, error, isLoading: false }));
    });
    return () => { active = false; unsubscribe(); };
  }, [client, name, key]);
  if (state.key !== key || state.name !== name) return { data: undefined, error: undefined, isLoading: true };
  return { data: state.data, error: state.error, isLoading: state.isLoading };
}
export function useMutation<P extends PebbleConfig, N extends MutationNames<P> = MutationNames<P>>(name: N) {
  const client = useClient();
  const [count, setCount] = useState(0);
  const [error, setError] = useState<BedrockError>();
  async function mutate(args: FunctionArgs<NonNullable<P["mutations"]>[N]>): Promise<ClientResult<NonNullable<P["mutations"]>[N]>> {
    setCount(value => value + 1);
    setError(undefined);
    try { return await client.mutate(name, args); }
    catch (cause) { const typed = asBedrockError(cause); setError(typed); throw typed; }
    finally { setCount(value => value - 1); }
  }
  return { mutate, isPending: count > 0, error };
}

export function useUser() {
  const client = useClient();
  const [state, setState] = useState<{ user: User | null; isLoading: boolean }>({ user: null, isLoading: true });
  useEffect(() => {
    let active = true;
    setState({ user: null, isLoading: true });
    void client.user().then(user => { if (active) setState({ user, isLoading: false }); }, () => { if (active) setState({ user: null, isLoading: false }); });
    return () => { active = false; };
  }, [client]);
  return state;
}

export function useUpload<P extends PebbleConfig>(bucket: import("../config/types").BucketNames<P>) {
  const client = useClient();
  const [progress, setProgress] = useState(0);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<BedrockError>();
  async function upload(file: File, options: import("../client").UploadOptions = {}) {
    setCount(n => n + 1); setProgress(0); setError(undefined);
    try { return await client.upload(bucket, file, { ...options, onProgress(value) { setProgress(value); options.onProgress?.(value); } }); }
    catch (cause) { const typed = asBedrockError(cause); setError(typed); throw typed; }
    finally { setCount(n => n - 1); }
  }
  return { upload, progress, isUploading: count > 0, error };
}

export function useRelease() {
  const client = useClient();
  const [release, setRelease] = useState(client.release);
  useEffect(() => {
    const unsubscribe = client.onRelease(setRelease);
    setRelease(client.release());
    return unsubscribe;
  }, [client]);
  return release;
}
