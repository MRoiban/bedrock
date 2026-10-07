import { sizeBytes } from "../storage/config";
import { BedrockError } from "../error";
import type { DetachedContext } from "./types";

export type ServiceValues = Record<string, any>;
export interface ServiceContext {
  pebble: { readonly name: string };
  dataDir: string;
  read: DetachedContext["read"];
  write: DetachedContext["write"];
  log: (...values: unknown[]) => void;
  signal: AbortSignal;
}
export interface ServiceDefinition<T = any> {
  start: (ctx: ServiceContext) => T | Promise<T>;
  stopTimeout?: number;
  stop?(value: T): void | Promise<void>;
}
export function service<T>(definition: ServiceDefinition<T>): ServiceDefinition<T> { return definition; }
export interface ApplicationSocketData<T = unknown> { value?: T }
export type ApplicationSocket<T = unknown> = Bun.ServerWebSocket<ApplicationSocketData<T>>;
export interface SocketDefinition<T = any> {
  maxMessageSize?: number | string;
  backpressureLimit?: number | string;
  open?: (ws: ApplicationSocket<T>, ctx: DetachedContext) => unknown;
  message: (ws: ApplicationSocket<T>, data: string | Buffer, ctx: DetachedContext) => unknown;
  close?: (ws: ApplicationSocket<T>, code: number, reason: string, ctx: DetachedContext) => unknown;
  drain?: (ws: ApplicationSocket<T>, ctx: DetachedContext) => unknown;
}
export function socket<T = unknown>(definition: SocketDefinition<T>): SocketDefinition<T> { return definition; }
export interface DirectoryBackup { directories: readonly string[]; exclude?: readonly string[] }
export type ServicesOf<P extends { services?: Record<string, ServiceDefinition> }> = {
  [K in keyof NonNullable<P["services"]>]: Awaited<ReturnType<NonNullable<P["services"]>[K]["start"]>>;
};

export const DEFAULT_SOCKET_MESSAGE_SIZE = 1024 * 1024;
export const DEFAULT_SERVICE_STOP_TIMEOUT = 2000;
export const MAX_SERVICE_STOP_TIMEOUT = 30000;
export function socketSize(value: number | string): number {
  try {
    const bytes = sizeBytes(value);
    if (bytes > 2 ** 31 - 1) throw new Error("Too large");
    return bytes;
  } catch {
    throw new BedrockError("INVALID_SOCKET", "Socket limits must be positive byte counts up to 2 GiB minus one, or sizes such as 16mb.", "Set maxMessageSize and optional backpressureLimit on socket().");
  }
}
export function serviceStopTimeout(definitions: Record<string, ServiceDefinition>): number {
  return Math.min(MAX_SERVICE_STOP_TIMEOUT, Math.max(DEFAULT_SERVICE_STOP_TIMEOUT, ...Object.values(definitions).map(value => value.stopTimeout ?? DEFAULT_SERVICE_STOP_TIMEOUT)));
}
