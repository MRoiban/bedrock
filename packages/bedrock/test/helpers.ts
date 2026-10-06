import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDirectory() {
  const dir = mkdtempSync(join(tmpdir(), "bedrock-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
