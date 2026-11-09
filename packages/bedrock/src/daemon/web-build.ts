import { join } from "node:path";
import { BedrockError } from "../error";
import { childEnvironment } from "./child-env";

let previous: Promise<void> = Promise.resolve();

// One compiler at a time keeps concurrent deploys from multiplying peak memory.
export async function buildReleaseWeb(release: string, environment: Record<string, string>, redact: (value: string) => string) {
  const work = previous.then(() => build(release, environment, redact));
  previous = work.catch(() => {});
  return work;
}

async function build(release: string, environment: Record<string, string>, redact: (value: string) => string) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../runtime/web-build-worker.ts")], {
    cwd: release, env: childEnvironment(process.env, environment, false, { NODE_ENV: "production", BEDROCK_RELEASE: release }),
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
  try {
    const [code, , stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new BedrockError("WEB_BUILD_FAILED", `Production browser build failed: ${redact(stderr.trim()) || "build process stopped or exceeded 120 seconds"}`,
      "Fix the browser entry, bunfig plugins or production dependencies, then redeploy. The previous release is still selected.");
  } finally { clearTimeout(timer); }
}
