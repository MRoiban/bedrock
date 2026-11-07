import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./index";
import { loadTestConfig, type TestPage } from "./config";

const pages: TestPage[] = JSON.parse(process.env.BEDROCK_TEST_PAGES ?? "[]");
for (const [index, state] of pages.entries()) {
  test(`smoke ${index + 1} ${state.path} (${state.user ?? "owner"})`, async ({ page, loginAs }, info) => {
    const checks: { name: string; status: string; durationMs?: number; detail?: unknown }[] = [];
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(`${message.text()} ${JSON.stringify(message.location())}`); });
    const check = async (name: string, run: () => Promise<unknown>) => {
      const started = Date.now();
      try { await run(); checks.push({ name, status: "passed", durationMs: Date.now() - started }); }
      catch (error) { checks.push({ name, status: "failed", durationMs: Date.now() - started, detail: String(error) }); }
    };
    try {
      await check("ready", async () => {
        await loginAs(page, state.user ?? "owner");
        const response = await page.goto(state.path);
        expect(response?.ok(), `HTTP ${response?.status()}`).toBe(true);
        expect(new URL(page.url()).pathname, "An auth redirect is not app readiness").not.toMatch(/^\/_bedrock\//);
        await expect(page.locator(state.ready ?? '[data-bedrock-ready], main, [role="main"]').first()).toBeVisible();
      });
      if (checks[0]?.status === "passed") {
        await check("accessibility", async () => {
          const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
          const path = info.outputPath("axe.json");
          await Bun.write(path, JSON.stringify({ violations: result.violations, incomplete: result.incomplete }, null, 2));
          await info.attach("axe", { path, contentType: "application/json" });
          checks.push({ name: "axe-incomplete", status: "review", detail: result.incomplete });
          expect(result.violations, "Definite WCAG A/AA violations (see axe attachment)").toEqual([]);
        });
        await check("overflow", async () => {
          const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
          expect(overflow.scroll - overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(1);
        });
        if (state.visual) await check("visual", async () => {
          await (await loadTestConfig(process.env.BEDROCK_TEST_DIR!)).prepareScreenshot?.(page);
          await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
          await expect(page).toHaveScreenshot(`page-${index + 1}.png`, { threshold: 0.2, maxDiffPixels: 0, animations: "disabled", caret: "hide" });
        });
      } else {
        for (const name of ["accessibility", "overflow", ...(state.visual ? ["visual"] : [])]) checks.push({ name, status: "skipped", detail: "App readiness failed" });
      }
      checks.push({ name: "browser-errors", status: errors.length ? "failed" : "passed", detail: errors });
      expect(checks.filter(check => check.status === "failed"), "Smoke failures").toEqual([]);
    } finally {
      await info.attach("checks", { body: JSON.stringify(checks), contentType: "application/json" });
    }
  });
}
