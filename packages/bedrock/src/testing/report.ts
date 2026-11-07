export interface Check {
  id: string;
  status: string;
  durationMs: number;
  attempts: number;
  artifacts: string[];
  detail?: unknown;
}
interface Attachment { name: string; path?: string; body?: string }
interface Result { status: string; duration: number; attachments: Attachment[]; errors?: unknown[] }
interface Spec { title: string; file: string; line: number; tests: { projectName: string; repeatEachIndex?: number; status: string; results: Result[] }[] }
interface Suite { suites?: Suite[]; specs?: Spec[] }
export function browserChecks(report: Suite): Check[] {
  const checks: Check[] = [];
  const visit = (suite: Suite) => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      const id = `${test.projectName}:${spec.file}:${spec.line}:${spec.title}${test.repeatEachIndex ? `:repeat-${test.repeatEachIndex + 1}` : ""}`;
      const artifacts = test.results.flatMap(result => result.attachments.flatMap(attachment => attachment.path ? [attachment.path] : []));
      const failed = test.results.some(result => !["passed", "skipped"].includes(result.status));
      const flaky = failed && test.results.some(result => result.status === "passed");
      const status = flaky ? "flaky" : failed ? "failed" : test.results.every(result => result.status === "skipped") ? "skipped" : "passed";
      checks.push({ id, status, durationMs: test.results.reduce((sum, result) => sum + result.duration, 0), attempts: test.results.length, artifacts,
        detail: { file: spec.file, line: spec.line, errors: test.results.flatMap(result => result.errors ?? []) } });
      for (const [attempt, result] of test.results.entries()) for (const attachment of result.attachments) if (attachment.name === "checks" && attachment.body) {
        const items: { name: string; status: string; durationMs?: number; detail?: unknown }[] = JSON.parse(Buffer.from(attachment.body, "base64").toString());
        checks.push(...items.map(item => ({ id: `${id}:${item.name}`, status: item.status, durationMs: item.durationMs ?? 0, attempts: attempt + 1, artifacts, detail: item.detail })));
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  visit(report);
  return checks;
}

export function unitChecks(xml: string): Check[] {
  const decode = (value: string) => value.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map((match, index) => ({
    id: `unit:${decode(/\bname="([^"]*)"/.exec(match[1]!)?.[1] ?? String(index))}`,
    status: /<(failure|error)\b/.test(match[2] ?? "") ? "failed" : /<skipped\b/.test(match[2] ?? "") ? "skipped" : "passed",
    durationMs: Number(/\btime="([^"]*)"/.exec(match[1]!)?.[1] ?? 0) * 1000,
    attempts: 1, artifacts: [], detail: match[2] ? decode(match[2]) : undefined,
  }));
}

export function sourceState(dir: string) {
  const git = (args: string[]) => {
    try {
      const result = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "ignore" });
      return result.exitCode === 0 ? result.stdout.toString().trim() : null;
    } catch { return null; }
  };
  const revision = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  return { revision, dirty: status === null ? null : status.length > 0 };
}
