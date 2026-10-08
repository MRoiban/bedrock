import { resolve } from "node:path";
import { version } from "../package.json";
import { run } from "./cli/terminal";

export const checkoutRoot = resolve(import.meta.dir, "../../..");
export interface BuildInfo { version: string; commit: string | null; branch: string | null; dirty: boolean | null; platform: string; arch: string; bun: string }
export async function buildInfo(checkout = checkoutRoot, execute = run, platform = process.platform): Promise<BuildInfo> {
  const info: BuildInfo = { version, commit: null, branch: null, dirty: null, platform, arch: process.arch, bun: Bun.version };
  try {
    const git = platform === "win32" ? "git.exe" : "git";
    const canonical = (path: string) => platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    if (canonical(await execute([git, "-C", checkout, "rev-parse", "--show-toplevel"])) !== canonical(checkout)) return info;
    info.commit = await execute([git, "-C", checkout, "rev-parse", "HEAD"]);
    info.branch = await execute([git, "-C", checkout, "symbolic-ref", "--short", "-q", "HEAD"]).catch(() => null);
    info.dirty = !!await execute([git, "-C", checkout, "status", "--porcelain"]);
  } catch { info.commit = null; info.branch = null; info.dirty = null; }
  return info;
}
export function formatBuild(info: Partial<BuildInfo>) {
  return `bedrock ${info.version ?? "unknown"}${info.commit ? ` ${info.branch ?? "detached"}@${info.commit.slice(0, 7)}${info.dirty ? " (dirty)" : ""}` : ""} · ${info.platform ?? "unknown"}-${info.arch ?? "unknown"} · bun ${info.bun ?? "unknown"}`;
}
