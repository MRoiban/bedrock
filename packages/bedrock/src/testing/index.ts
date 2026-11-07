import { test as base, expect, type Page } from "@playwright/test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { launchDev } from "../cli/dev-launcher";
import { BedrockError } from "../error";
import { fixtureUsers, loadTestConfig, type TestRole } from "./config";

export type { TestConfig, TestPage, SeedContext, TestRole } from "./config";
export { expect };
type Server = Awaited<ReturnType<typeof launchDev>> & { home: string };
interface Fixtures {
  server: Server;
  loginAs: (page: Page, role: TestRole) => Promise<void>;
  anonymous: Page;
  owner: Page;
  friend: Page;
  outsider: Page;
}

export async function loginAs(page: Page, role: TestRole) {
  const baseURL = process.env.BEDROCK_TEST_URL;
  if (!baseURL) throw new BedrockError("TEST_SERVER_MISSING", "No Bedrock test server is running.", "Run this spec with bedrock test and import test from bedrock/testing.");
  if (role === "anonymous") { await page.context().clearCookies(); return; }
  const users = fixtureUsers(await loadTestConfig(process.env.BEDROCK_TEST_DIR!));
  const user = users[role];
  if (!user) throw new BedrockError("INVALID_TEST_USER", `Unknown fixture: ${role}`, "Use anonymous, owner, friend, or outsider.");
  await page.goto(new URL("/_bedrock/dev-login", baseURL).href);
  await page.getByLabel("Email", { exact: true }).fill(user.email!);
  await page.getByLabel("Name", { exact: false }).fill(user.name!);
  await Promise.all([page.waitForURL(url => !url.pathname.startsWith("/_bedrock/")), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
  const identity = await page.evaluate(async () => (await fetch("/_bedrock/me")).json());
  expect(identity.user?.id).toBe(user.id);
}

export const test = base.extend<Fixtures>({
  server: async ({}, use, info) => {
    const root = process.env.BEDROCK_TEST_CASES;
    if (!root) throw new BedrockError("TEST_SERVER_MISSING", "Missing test run directory.", "Run bedrock test instead of playwright test.");
    const home = await mkdtemp(join(root, "case-"));
    let server: Awaited<ReturnType<typeof launchDev>> | undefined;
    try {
      await cp(process.env.BEDROCK_TEST_TEMPLATE!, home, { recursive: true });
      process.env.BEDROCK_HOME = home;
      server = await launchDev({ dir: process.env.BEDROCK_TEST_DIR!, home, dataDir: join(home, "data"), port: 0, watch: false, cron: false });
      process.env.BEDROCK_TEST_URL = server.url;
      await use({ ...server, home });
    } finally {
      await server?.stop();
      delete process.env.BEDROCK_TEST_URL;
      const logs = join(home, "pebbles");
      await cp(logs, info.outputPath("server-logs"), { recursive: true }).catch(() => {});
      await rm(home, { recursive: true, force: true });
    }
  },
  baseURL: async ({ server }, use) => { await use(server.url); },
  loginAs: async ({ server }, use) => { await use(loginAs); },
  anonymous: async ({ browser, server, contextOptions, viewport }, use) => {
    const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC", deviceScaleFactor: 1, reducedMotion: "reduce", ...contextOptions, baseURL: server.url, viewport });
    try { await use(await context.newPage()); } finally { await context.close(); }
  },
  owner: async ({ browser, server, contextOptions, viewport }, use) => {
    const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC", deviceScaleFactor: 1, reducedMotion: "reduce", ...contextOptions, baseURL: server.url, viewport });
    try { const page = await context.newPage(); await loginAs(page, "owner"); await use(page); } finally { await context.close(); }
  },
  friend: async ({ browser, server, contextOptions, viewport }, use) => {
    const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC", deviceScaleFactor: 1, reducedMotion: "reduce", ...contextOptions, baseURL: server.url, viewport });
    try { const page = await context.newPage(); await loginAs(page, "friend"); await use(page); } finally { await context.close(); }
  },
  outsider: async ({ browser, server, contextOptions, viewport }, use) => {
    const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC", deviceScaleFactor: 1, reducedMotion: "reduce", ...contextOptions, baseURL: server.url, viewport });
    try { const page = await context.newPage(); await loginAs(page, "outsider"); await use(page); } finally { await context.close(); }
  },
});
