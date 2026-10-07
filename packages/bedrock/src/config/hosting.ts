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
  stop?(value: T): void | Promise<void>;
}
export function service<T>(definition: ServiceDefinition<T>): ServiceDefinition<T> { return definition; }
export interface ApplicationSocketData<T = unknown> { value?: T }
export type ApplicationSocket<T = unknown> = Bun.ServerWebSocket<ApplicationSocketData<T>>;
export interface SocketDefinition<T = any> {
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
