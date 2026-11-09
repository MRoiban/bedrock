import type { Page } from "@playwright/test";
import type { openDatabase } from "../db";
import type { User } from "../config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BedrockError } from "../error";

export type TestRole = "anonymous" | "owner" | "friend" | "outsider";
export interface TestPage { path: string; user?: TestRole; ready?: string; visual?: boolean }
export interface SeedContext {
  db: ReturnType<typeof openDatabase>["db"];
  sqlite: ReturnType<typeof openDatabase>["sqlite"];
  dataDir: string;
  users: Record<Exclude<TestRole, "anonymous">, User & { email: string; name: string }>;
  now: Date;
}
export interface TestConfig {
  seed?: (context: SeedContext) => unknown | Promise<unknown>;
  users?: Partial<Record<Exclude<TestRole, "anonymous">, string>>;
  pages?: TestPage[];
  prepareScreenshot?: (page: Page) => unknown | Promise<unknown>;
}
export const fixtureDate = "2024-01-01T00:00:00.000Z";
export function fixtureUsers(config: TestConfig): SeedContext["users"] {
  return Object.fromEntries(["owner", "friend", "outsider"].map(role => [role, {
    id: `bedrock-test-${role}`, email: (config.users?.[role as keyof typeof config.users] ?? `${role}@example.test`).toLowerCase(), name: role,
  }])) as SeedContext["users"];
}
export async function loadTestConfig(dir: string): Promise<TestConfig> {
  const path = resolve(dir, "bedrock.test.ts");
  const config: TestConfig = await Bun.file(path).exists() ? (await import(pathToFileURL(path).href)).default : {};
  const invalid = (message: string): never => { throw new BedrockError("INVALID_TEST_CONFIG", message, "Export { seed?, users?, pages?, prepareScreenshot? } from bedrock.test.ts; see Testing your pebble."); };
  if (!config || typeof config !== "object" || Array.isArray(config)) invalid("Expected a test configuration object.");
  for (const key of Object.keys(config)) if (!["seed", "users", "pages", "prepareScreenshot"].includes(key)) invalid(`Unknown test option: ${key}`);
  if (config.seed !== undefined && typeof config.seed !== "function") invalid("seed must be a function.");
  if (config.prepareScreenshot !== undefined && typeof config.prepareScreenshot !== "function") invalid("prepareScreenshot must be a function.");
  if (config.users !== undefined && (!config.users || typeof config.users !== "object" || Array.isArray(config.users))) invalid("users must map fixture roles to emails.");
  for (const [role, email] of Object.entries(config.users ?? {})) {
    if (!["owner", "friend", "outsider"].includes(role) || typeof email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(email)) invalid(`Invalid fixture user: ${role}`);
  }
  if (new Set(Object.values(fixtureUsers(config)).map(user => user.email.toLowerCase())).size !== 3) invalid("Fixture users must have distinct emails.");
  if (config.pages !== undefined && !Array.isArray(config.pages)) invalid("pages must be an array.");
  for (const page of config.pages ?? []) {
    if (!page || typeof page !== "object" || Object.keys(page).some(key => !["path", "user", "ready", "visual"].includes(key)) || typeof page.path !== "string" || !page.path.startsWith("/") || page.path.startsWith("//") || /[\\\r\n]/.test(page.path) ||
      page.user !== undefined && !["anonymous", "owner", "friend", "outsider"].includes(page.user) || page.ready !== undefined && (typeof page.ready !== "string" || !page.ready.trim()) || page.visual !== undefined && typeof page.visual !== "boolean") invalid("Invalid smoke page.");
  }
  if (!config.seed && await Bun.file(resolve(dir, "tests/seed.ts")).exists()) config.seed = (await import(pathToFileURL(resolve(dir, "tests/seed.ts")).href)).default;
  if (config.seed !== undefined && typeof config.seed !== "function") invalid("tests/seed.ts must default-export a seed function.");
  return config;
}
