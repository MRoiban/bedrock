import { mkdtempSync, rmSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmod } from "node:fs/promises";

export function tempDirectory() {
  const dir = mkdtempSync(join(tmpdir(), "bedrock-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function testExecutable(path: string, source: string) {
  await Bun.write(path, `#!${process.execPath}\n${source}`);
  await chmod(path, 0o700);
  return path;
}
export function testCommand(path: string) {
  return process.platform === "win32" ? [process.execPath, path] : path;
}
export function linkDependencies(source: string, target: string) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const origin = join(source, entry.name), destination = join(target, entry.name);
    if (entry.name.startsWith("@")) linkDependencies(origin, destination);
    else symlinkSync(realpathSync(origin), destination, process.platform === "win32" ? "junction" : "dir");
  }
}

import { signIdentity } from "../src/auth/identity";
const testSecret = "bedrock-test-signing-secret";
export function identityHeaders(id: string, email = `${id}@example.test`) {
  process.env.BEDROCK_IDENTITY_SECRET = testSecret;
  return signIdentity({ id, email, name: id }, testSecret);
}
export const HeaderWebSocket = WebSocket as unknown as new (url: URL, options: Bun.WebSocketOptions) => WebSocket;
