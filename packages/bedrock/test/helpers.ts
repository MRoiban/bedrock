import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDirectory() {
  const dir = mkdtempSync(join(tmpdir(), "bedrock-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

import { signIdentity } from "../src/auth/identity";
const testSecret = "bedrock-test-signing-secret";
export function identityHeaders(id: string, email = `${id}@example.test`) {
  process.env.BEDROCK_IDENTITY_SECRET = testSecret;
  return signIdentity({ id, email, name: id }, testSecret);
}
export const HeaderWebSocket = WebSocket as unknown as new (url: URL, options: Bun.WebSocketOptions) => WebSocket;
