import { mkdtemp, mkdir, rm, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { childEnvironment } from "../daemon/child-env";
import { BedrockError, asBedrockError } from "../error";
import { testOptions } from "./test-options";
import type { Parsed } from "./spec";
import { browserChecks, unitChecks, sourceState, type Check } from "../testing/report";
import { pruneRuns } from "../testing/artifacts";

const testing = resolve(import.meta.dir, "../testing");
async function run(argv: string[], cwd: string, env: NodeJS.ProcessEnv, log: string) {
  const stream = openSync(log, "w");
  const child = Bun.spawn(argv, { cwd, env, stdin: "ignore", stdout: stream, stderr: stream });
  const stop = () => child.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try { return await child.exited; }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); closeSync(stream); }
}
async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const name of await readdir(root, { withFileTypes: true })) {
    const path = join(root, name.name);
    if (name.isDirectory()) result.push(...await files(path));
    else if (name.isFile()) result.push(path);
  }
  return result;
}
function playwrightCli() {
  try { return fileURLToPath(import.meta.resolve("@playwright/test/cli")); }
  catch { throw new BedrockError("TEST_DEPENDENCIES_MISSING", "Browser testing dependencies are not installed.", "Run bun add --dev @playwright/test@1.64.0 @axe-core/playwright@4.14.0 && bunx playwright install chromium."); }
}

export async function testCommand(parsed: Parsed, json: boolean) {
  const options = testOptions(parsed);
  const dir = process.cwd();
  const started = Date.now();
  const runId = new Date().toISOString().replace(/[:.]/g, "-") + `-${crypto.randomUUID().slice(0, 8)}`;
  const root = join(dir, ".bedrock", "tests");
  const output = join(root, runId);
  await mkdir(output, { recursive: true });
  const temp = await mkdtemp(join(tmpdir(), "bedrock-harness-"));
  const checks: Check[] = [];
  let setupError: ReturnType<BedrockError["toJSON"]> | undefined;
  let exitCode = 0;
  let configuration: unknown;
  let chromiumVersion: string | null = null;
  const env = childEnvironment(process.env, {}, false, { BEDROCK_HOME: temp, BEDROCK_TEST_DIR: dir, BEDROCK_TEST_TEMPLATE: join(temp, "template"), BEDROCK_TEST_CASES: join(temp, "cases"), BEDROCK_TEST_MANIFEST: join(temp, "manifest.json"), BEDROCK_TEST_LIST: options.list ? "1" : "0", TZ: "UTC" });
  const repro = ["bedrock", ...parsed.path,
    ...Object.entries(parsed.flags).flatMap(([name, value]) => value === true ? [name] : [name, value]),
    ...(json ? ["--json"] : []), ...(parsed.positionals.length ? ["--", ...parsed.positionals] : [])];
  try {
    if (!options.list) {
      const unitDir = join(dir, "tests", "unit");
      if ((await stat(unitDir).catch(() => null))?.isDirectory()) {
        const time = Date.now();
        const junit = join(output, "unit.xml");
        const code = await run([process.execPath, "test", "./tests/unit", "--reporter=junit", `--reporter-outfile=${junit}`], dir, env, join(output, "unit.log"));
        const units = await Bun.file(junit).exists() ? unitChecks(await Bun.file(junit).text()) : [];
        checks.push(...units);
        if (code || !units.length) { exitCode = 1; checks.push({ id: "unit-runner", status: "failed", durationMs: Date.now() - time, attempts: 1, artifacts: [join(output, "unit.log")], detail: `Bun exited ${code}; ${units.length} test cases reported` }); }
      } else checks.push({ id: "unit", status: "skipped", durationMs: 0, attempts: 0, artifacts: [], detail: "No tests/unit directory" });
    }
    await mkdir(env.BEDROCK_TEST_CASES!, { recursive: true });
    const code = await run([process.execPath, join(testing, "prepare.ts")], dir, env, join(output, "seed.log"));
    if (!await Bun.file(env.BEDROCK_TEST_MANIFEST!).exists()) throw new BedrockError("TEST_SETUP_FAILED", `Seed process exited ${code}.`, `Read ${join(output, "seed.log")}.`);
    const manifest = await Bun.file(env.BEDROCK_TEST_MANIFEST!).json();
    if (!manifest.ok) throw new BedrockError(manifest.error.code, manifest.error.message, manifest.error.hint);
    configuration = manifest.value;
    if (manifest.value.anonymousRoot === "protected") checks.push({ id: "anonymous-root", status: "skipped", durationMs: 0, attempts: 0, artifacts: [], detail: "Root requires authentication; declare an accessible anonymous page in bedrock.test.ts to test it." });
    const { pages } = manifest.value;
    env.BEDROCK_TEST_PAGES = JSON.stringify(pages);
    const specs = await Array.fromAsync(new Bun.Glob("tests/e2e/**/*.spec.ts").scan({ cwd: dir, absolute: true }));
    const selected = options.path ? specs.filter(path => path.includes(options.path)) : specs;
    if (options.path && !selected.length) throw new BedrockError("INVALID_ARGS", `No e2e specs match ${options.path}.`, "Use a path under tests/e2e, or omit the path for built-in smoke checks.");
    const smoke = join(output, "smoke.spec.ts");
    if (pages.length && !options.path) await Bun.write(smoke, `import ${JSON.stringify(join(testing, "smoke.ts"))};\n`);
    const testMatch = [...selected, ...(pages.length && !options.path ? [smoke] : [])];
    if (testMatch.length) {
      const cli = playwrightCli();
      try { await import("@axe-core/playwright"); } catch { throw new BedrockError("TEST_DEPENDENCIES_MISSING", "axe is not installed.", "Run bun add --dev @axe-core/playwright@4.14.0."); }
      if (!options.list) {
        try {
          const browser = await (await import("@playwright/test")).chromium.launch({ headless: !options.headed });
          try { chromiumVersion = browser.version(); } finally { await browser.close(); }
        } catch (error) { throw new BedrockError("TEST_BROWSER_MISSING", "Pinned Chromium could not start.", `Run bunx playwright install chromium (and install-deps on Linux if needed). ${String(error)}`); }
      }
      const config = join(output, "playwright.config.ts");
      const report = join(output, "playwright.json");
      const settings = { testDir: dir, testMatch, testIgnore: [], respectGitIgnore: false, workers: 1, fullyParallel: false, forbidOnly: true,
        retries: options.diagnosticRetry ? 1 : 0, failOnFlakyTests: true, timeout: 30_000,
        repeatEach: options.repeat,
        updateSnapshots: options.updateSnapshots ? "all" : "none", outputDir: join(output, "browser"),
        snapshotPathTemplate: join(dir, "tests/e2e/__screenshots__/{platform}/{projectName}/{testFileName}/{arg}{ext}"),
        reporter: [["json", { outputFile: report }]],
        expect: { timeout: 10_000, toHaveScreenshot: { threshold: 0.2, maxDiffPixels: 0, animations: "disabled" } },
        use: { browserName: "chromium", headless: !options.headed, locale: "en-US", timezoneId: "UTC", deviceScaleFactor: 1, reducedMotion: "reduce", trace: "retain-on-failure", screenshot: "only-on-failure" },
        projects: [{ name: "desktop", use: { viewport: { width: 1280, height: 800 } } }, { name: "phone", use: { viewport: { width: 390, height: 844 } } }],
      };
      await Bun.write(config, `export default ${JSON.stringify(settings)};\n`);
      const argv = [process.execPath, cli, "test", "--config", config, ...(options.grep ? ["--grep", options.grep] : []), ...(options.project ? ["--project", options.project] : []), ...(options.list ? ["--list"] : [])];
      const browserCode = await run(argv, dir, { ...env, FORCE_COLOR: "0" }, join(output, "browser.log"));
      if (!await Bun.file(report).exists()) throw new BedrockError("TEST_BROWSER_FAILED", `Playwright exited ${browserCode} without a report.`, `Read ${join(output, "browser.log")}; install Chromium with bunx playwright install chromium.`);
      const browserReport = await Bun.file(report).json();
      checks.push(...browserChecks(browserReport));
      if (browserReport.errors?.length) throw new BedrockError("TEST_BROWSER_FAILED", "Playwright could not collect or run tests.", JSON.stringify(browserReport.errors));
      if (browserCode) exitCode = 1;
    } else checks.push({ id: "browser", status: "skipped", durationMs: 0, attempts: 0, artifacts: [], detail: "API-only pebble or no selected browser checks" });
  } catch (error) { setupError = asBedrockError(error, "TEST_SETUP_FAILED", `Read logs in ${output}.`).toJSON(); exitCode = 2; }
  finally { await rm(temp, { recursive: true, force: true }); }
  if (checks.some(check => ["failed", "flaky"].includes(check.status)) && !exitCode) exitCode = 1;
  await Bun.write(join(output, "complete.json"), JSON.stringify({ exitCode }));
  const retention = await pruneRuns(root, runId);
  const value = { version: 1, runId, durationMs: Date.now() - started, exitCode, source: sourceState(dir), configuration, environment: { platform: process.platform, arch: process.arch, bun: Bun.version, pinnedPlaywright: "1.64.0", chromium: chromiumVersion, pinnedAxe: "4.14.0" }, checks, artifacts: await files(output), repro, retention, ...(setupError ? { setupError } : {}) };
  const envelope = exitCode ? { ok: false, error: { code: setupError?.code ?? "TEST_FAILED", message: setupError?.message ?? "Pebble checks failed.", hint: setupError?.hint ?? "Read the check details and artifacts, then reproduce with the reported argv.", data: value } } : { ok: true, value };
  console.log(json ? JSON.stringify(envelope) : JSON.stringify(envelope, null, 2));
  process.exitCode = exitCode;
}
